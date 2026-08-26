//
//  ImageUpload.swift
//  bearlake-client
//

import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Everything between "the user picked a photo" and "here is the S3 key"
/// (C41/C42/C43).

enum ImageUploadError: Error, Equatable {
    /// Not one of the types the server accepts.
    case unsupportedType(String?)
    /// Larger than the server's cap, before any downscaling.
    case tooLarge(bytes: Int)
    /// The bytes were not a decodable image.
    case undecodable
    /// Re-encoding failed.
    case encodingFailed
    /// S3 rejected the PUT.
    case uploadFailed(status: Int)

    var message: String {
        switch self {
        case .unsupportedType:
            return "That kind of photo isn't supported. Try a JPEG, PNG, or HEIC."
        case .tooLarge:
            return "That photo is too large."
        case .undecodable, .encodingFailed:
            return "That photo couldn't be read."
        case .uploadFailed:
            return "The photo couldn't be uploaded. Please try again."
        }
    }
}

/// Validation and downscaling. Pure, so it is testable without a network.
enum ImageProcessing {
    /// Max pixels on the long edge (C41). Nothing in this app needs more, and
    /// an unmodified iPhone photo is several times this.
    static let maxPixelSize = 2000
    static let jpegQuality: CGFloat = 0.85

    struct Prepared: Equatable {
        let data: Data
        /// Always `image/jpeg` — everything is re-encoded (C41).
        let contentType: String
        let pixelWidth: Int
        let pixelHeight: Int
    }

    /// Sniffs the container from its magic bytes.
    ///
    /// The file extension is not available from `PhotosPicker` and would be
    /// untrustworthy anyway; the bytes are the only honest source.
    static func detectedContentType(of data: Data) -> String? {
        guard data.count >= 12 else { return nil }
        let bytes = [UInt8](data.prefix(12))

        if bytes[0] == 0xFF, bytes[1] == 0xD8, bytes[2] == 0xFF { return "image/jpeg" }
        if bytes[0] == 0x89, bytes[1] == 0x50, bytes[2] == 0x4E, bytes[3] == 0x47 {
            return "image/png"
        }
        // HEIC: an ISO-BMFF box whose type is 'ftyp' with a heic/heix/mif1 brand.
        if bytes[4] == 0x66, bytes[5] == 0x74, bytes[6] == 0x79, bytes[7] == 0x70 {
            let brand = String(bytes: bytes[8..<12], encoding: .ascii) ?? ""
            if ["heic", "heix", "hevc", "mif1", "msf1"].contains(brand) { return "image/heic" }
        }
        return nil
    }

    /// Validates, then downscales and re-encodes to JPEG.
    ///
    /// Validation runs **before** any presign call, so a photo the server
    /// would reject never costs a round trip (and never creates an orphan
    /// key).
    static func prepare(_ data: Data) throws -> Prepared {
        guard let type = detectedContentType(of: data),
              Limits.allowedUploadContentTypes.contains(type)
        else {
            throw ImageUploadError.unsupportedType(detectedContentType(of: data))
        }
        // A decode-safety ceiling, not the upload limit: refuse to hand
        // ImageIO something absurd. The real cap is applied below, to the
        // bytes actually sent.
        guard data.count <= Limits.maxDecodeBytes else {
            throw ImageUploadError.tooLarge(bytes: data.count)
        }

        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) > 0
        else {
            throw ImageUploadError.undecodable
        }

        // Thumbnailing through ImageIO rather than decoding the full image:
        // a 12 MP photo would otherwise be ~48 MB in memory before we shrink
        // it, which is how an image picker crashes a phone.
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else {
            throw ImageUploadError.undecodable
        }

        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(
            output, UTType.jpeg.identifier as CFString, 1, nil
        ) else {
            throw ImageUploadError.encodingFailed
        }
        CGImageDestinationAddImage(
            destination, thumbnail,
            [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else {
            throw ImageUploadError.encodingFailed
        }

        // The cap the server enforces applies to contentLength — the
        // post-downscale JPEG — so it belongs here, after the re-encode.
        // Checking the original instead rejected photos that would have
        // uploaded comfortably: a 12 MB panorama becomes a few hundred KB at
        // 2000 px / q0.85, and the family's phones produce exactly that.
        guard output.length <= Limits.maxUploadBytes else {
            throw ImageUploadError.tooLarge(bytes: output.length)
        }

        return Prepared(
            data: output as Data,
            // Always JPEG: iOS decodes HEIC natively, so the client that most
            // often produces it is also the one that can normalise it. The
            // web app cannot, and uploads HEIC untouched (C41).
            contentType: "image/jpeg",
            pixelWidth: thumbnail.width,
            pixelHeight: thumbnail.height
        )
    }
}

/// Presigns and PUTs. Separate from `ImageProcessing` so the pure half stays
/// testable without a network.
actor ImageUploader {
    /// Injected so tests never touch S3. Returns the HTTP status.
    typealias Putter = @Sendable (URLRequest, Data, @escaping @Sendable (Double) -> Void) async throws -> Int

    private let api: BearLakeAPI
    private let put: Putter

    init(api: BearLakeAPI, put: @escaping Putter = ImageUploader.defaultPut) {
        self.api = api
        self.put = put
    }

    /// What a finished upload hands back: the S3 key to store on the block,
    /// and the exact bytes that were sent so a caller can seed an image cache
    /// without re-fetching them. The presigned URL is deliberately absent —
    /// it expires, and only the key is persisted (C34).
    struct Uploaded: Equatable {
        let key: String
        let data: Data
    }

    func upload(
        _ data: Data,
        articleID: String,
        onProgress: @escaping @Sendable (Double) -> Void = { _ in }
    ) async throws -> Uploaded {
        let prepared = try ImageProcessing.prepare(data)

        // The presigned PUT signs Content-Type AND Content-Length, so the
        // declared byte count must be the bytes actually sent — the
        // post-downscale count, never the original. A mismatch is rejected by
        // S3, not by us, and the error is opaque when it happens.
        let presign = try await api.presignUpload(
            PresignUploadRequest(
                articleId: articleID,
                contentType: prepared.contentType,
                contentLength: prepared.data.count
            )
        )

        guard let url = URL(string: presign.uploadUrl) else {
            throw ImageUploadError.uploadFailed(status: 0)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(prepared.contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(String(prepared.data.count), forHTTPHeaderField: "Content-Length")

        let status = try await put(request, prepared.data, onProgress)
        guard (200..<300).contains(status) else {
            throw ImageUploadError.uploadFailed(status: status)
        }
        return Uploaded(key: presign.key, data: prepared.data)
    }

    /// A silent multi-second upload on cellular reads as a frozen app, so
    /// progress is reported throughout (C43).
    static let defaultPut: Putter = { request, data, onProgress in
        let delegate = UploadProgressDelegate(onProgress: onProgress)
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (_, response) = try await session.upload(for: request, from: data)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
}

/// Feeds upload progress back to the editor.
private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let onProgress: @Sendable (Double) -> Void

    init(onProgress: @escaping @Sendable (Double) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        guard totalBytesExpectedToSend > 0 else { return }
        onProgress(Double(totalBytesSent) / Double(totalBytesExpectedToSend))
    }
}

//
//  ImageUploadTests.swift
//  bearlake-clientTests
//

import Foundation
import UIKit
import Testing
@testable import bearlake_client

/// Real image bytes, so ImageIO has something genuine to work on.
///
/// `scale = 1` is deliberate: the renderer otherwise uses the device scale,
/// so asking for 800x600 on a 3x simulator produces a 2400x1800 pixel image
/// and every dimension assertion below would be measuring the wrong thing.
private func makeImage(width: Int, height: Int, asPNG: Bool = false) -> Data {
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(
        size: CGSize(width: width, height: height), format: format
    )
    let image = renderer.image { context in
        UIColor.systemTeal.setFill()
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        UIColor.systemPink.setFill()
        context.fill(CGRect(x: 0, y: 0, width: width / 2, height: height / 2))
    }
    return (asPNG ? image.pngData() : image.jpegData(compressionQuality: 0.95)) ?? Data()
}

// MARK: - Validation, before any network call

struct ImageValidationTests {
    @Test("JPEG, PNG, and HEIC magic bytes are recognised")
    func detectsTypes() {
        #expect(ImageProcessing.detectedContentType(of: makeImage(width: 40, height: 40)) == "image/jpeg")
        #expect(ImageProcessing.detectedContentType(of: makeImage(width: 40, height: 40, asPNG: true)) == "image/png")

        // A minimal ISO-BMFF header with a heic brand.
        var heic = Data([0, 0, 0, 0x18])
        heic.append(contentsOf: Array("ftypheic".utf8))
        heic.append(contentsOf: [0, 0, 0, 0])
        #expect(ImageProcessing.detectedContentType(of: heic) == "image/heic")
    }

    /// The extension is not available from PhotosPicker and would be
    /// untrustworthy anyway — the bytes are the only honest source.
    @Test("a non-image is rejected on its bytes, not its name")
    func rejectsNonImage() {
        let text = Data("This is definitely not a photograph.".utf8)
        #expect(ImageProcessing.detectedContentType(of: text) == nil)
        #expect(throws: ImageUploadError.self) { try ImageProcessing.prepare(text) }
    }

    @Test("an empty or truncated payload is rejected rather than crashing")
    func rejectsTruncated() {
        #expect(throws: ImageUploadError.self) { try ImageProcessing.prepare(Data()) }
        #expect(throws: ImageUploadError.self) { try ImageProcessing.prepare(Data([0xFF, 0xD8])) }
    }

    @Test("anything over the cap is rejected before work begins")
    func rejectsOversize() {
        var oversized = makeImage(width: 40, height: 40)
        oversized.append(Data(repeating: 0, count: Limits.maxDecodeBytes + 1))
        #expect(throws: ImageUploadError.self) { try ImageProcessing.prepare(oversized) }
    }
}

// MARK: - Downscaling

struct ImageDownscaleTests {
    /// C41 — 2000 px on the long edge.
    @Test("a large image is downscaled to the long-edge cap")
    func downscalesLargeImage() throws {
        let original = makeImage(width: 3000, height: 2000)
        let prepared = try ImageProcessing.prepare(original)

        #expect(max(prepared.pixelWidth, prepared.pixelHeight) == ImageProcessing.maxPixelSize)
        // Aspect ratio preserved: 3:2 in, 3:2 out.
        #expect(prepared.pixelWidth == 2000)
        #expect(prepared.pixelHeight == 1333 || prepared.pixelHeight == 1334)
        #expect(prepared.data.count < original.count, "and it got smaller")
    }

    @Test("a portrait image caps its height, not its width")
    func downscalesPortrait() throws {
        let prepared = try ImageProcessing.prepare(makeImage(width: 2000, height: 3000))
        #expect(prepared.pixelHeight == ImageProcessing.maxPixelSize)
        #expect(prepared.pixelWidth < prepared.pixelHeight)
    }

    @Test("an image already under the cap is not enlarged")
    func doesNotUpscale() throws {
        let prepared = try ImageProcessing.prepare(makeImage(width: 800, height: 600))
        #expect(prepared.pixelWidth <= 800)
        #expect(prepared.pixelHeight <= 600)
    }

    /// C41's deliberate divergence from the web app: iOS re-encodes
    /// everything, including PNG and HEIC, because it can decode them and the
    /// browser cannot.
    @Test("everything is re-encoded to JPEG, including PNG input")
    func alwaysReencodesToJPEG() throws {
        let fromPNG = try ImageProcessing.prepare(makeImage(width: 500, height: 500, asPNG: true))
        #expect(fromPNG.contentType == "image/jpeg")
        #expect(ImageProcessing.detectedContentType(of: fromPNG.data) == "image/jpeg",
                "the bytes really are JPEG, not just the label")

        let fromJPEG = try ImageProcessing.prepare(makeImage(width: 500, height: 500))
        #expect(fromJPEG.contentType == "image/jpeg")
    }

    @Test("the output is always on the server's allowlist")
    func outputIsAllowed() throws {
        let prepared = try ImageProcessing.prepare(makeImage(width: 900, height: 900, asPNG: true))
        #expect(Limits.allowedUploadContentTypes.contains(prepared.contentType))
    }
}

// MARK: - The presign + PUT pipeline

/// Records what was presigned and what was actually PUT.
private actor UploadRecorder {
    var presignRequests: [PresignUploadRequest] = []
    var putRequests: [(request: URLRequest, byteCount: Int)] = []
    var status = 200
    var progressReports: [Double] = []

    func recordPut(_ request: URLRequest, _ data: Data) -> Int {
        putRequests.append((request, data.count))
        return status
    }
    func setStatus(_ value: Int) { status = value }
    func recordProgress(_ value: Double) { progressReports.append(value) }
}

/// A FakeAPI subclass would be cleaner, but FakeAPI is an actor; this wraps
/// it and records the presign call.
private extension UploadRecorder {
    func append(_ request: PresignUploadRequest) { presignRequests.append(request) }
}

private actor RecordingAPI: BearLakeAPI {
    let recorder: UploadRecorder
    var nextError: APIError?
    init(recorder: UploadRecorder) { self.recorder = recorder }
    func setNextError(_ error: APIError?) { nextError = error }

    func presignUpload(_ body: PresignUploadRequest) async throws -> PresignUploadResponse {
        await recorder.append(body)
        if let nextError { self.nextError = nil; throw nextError }
        return PresignUploadResponse(
            key: "articles/\(body.articleId)/00000000-0000-4000-8000-000000000001",
            uploadUrl: "https://bearlake-media-prod.s3.amazonaws.com/signed?X-Amz-Expires=900"
        )
    }

    // Unused here.
    func login(email: String, password: String) async throws -> SessionResult { throw APIError.notFound }
    func logout() async throws {}
    func changePassword(currentPassword: String, newPassword: String) async throws -> SessionResult { throw APIError.notFound }
    func me() async throws -> PublicUser { .fixture() }
    func listEvents(start: Date, end: Date) async throws -> [CalendarEvent] { [] }
    func createEvent(_ body: CreateEventRequest) async throws -> CalendarEvent { throw APIError.notFound }
    func getEvent(id: String) async throws -> CalendarEvent { throw APIError.notFound }
    func updateEvent(id: String, _ body: UpdateEventRequest) async throws -> CalendarEvent { throw APIError.notFound }
    func deleteEvent(id: String) async throws {}
    func listAnnouncements(limit: Int?, cursor: String?) async throws -> AnnouncementPage { .init(items: [], nextCursor: nil) }
    func createAnnouncement(body: String) async throws -> Announcement { .fixture() }
    func updateAnnouncement(id: String, body: String) async throws -> Announcement { .fixture() }
    func deleteAnnouncement(id: String) async throws {}
    func listQuickTips() async throws -> [QuickTip] { [] }
    func createQuickTip(_ body: CreateQuickTipRequest) async throws -> QuickTip { throw APIError.notFound }
    func updateQuickTip(id: String, _ body: UpdateQuickTipRequest) async throws -> QuickTip { throw APIError.notFound }
    func deleteQuickTip(id: String) async throws {}
    func listCategories() async throws -> [InfoCategory] { [] }
    func createCategory(_ body: CreateCategoryRequest) async throws -> InfoCategory { throw APIError.notFound }
    func updateCategory(id: String, _ body: UpdateCategoryRequest) async throws -> InfoCategory { throw APIError.notFound }
    func deleteCategory(id: String) async throws {}
    func listArticles(categoryID: String) async throws -> [ArticleSummary] { [] }
    func getArticle(id: String) async throws -> InfoArticle { throw APIError.notFound }
    func createArticle(_ body: CreateArticleRequest) async throws -> InfoArticle { throw APIError.notFound }
    func updateArticle(id: String, _ body: UpdateArticleRequest) async throws -> InfoArticle { throw APIError.notFound }
    func deleteArticle(id: String) async throws {}
}

struct ImageUploadPipelineTests {
    private func makeUploader(_ recorder: UploadRecorder) -> (ImageUploader, RecordingAPI) {
        let api = RecordingAPI(recorder: recorder)
        let uploader = ImageUploader(api: api) { request, data, onProgress in
            onProgress(0.5)
            onProgress(1.0)
            await recorder.recordProgress(0.5)
            await recorder.recordProgress(1.0)
            return await recorder.recordPut(request, data)
        }
        return (uploader, api)
    }

    /// C42's central requirement. The presigned PUT signs Content-Type AND
    /// Content-Length, so a mismatch is rejected by S3 with an opaque error.
    /// The declared count must be the POST-downscale bytes.
    @Test("the presigned Content-Length equals the bytes actually sent")
    func contentLengthMatchesBytesSent() async throws {
        let recorder = UploadRecorder()
        let (uploader, _) = makeUploader(recorder)
        let original = makeImage(width: 3000, height: 2000)

        _ = try await uploader.upload(original, articleID: "art-1")

        let presign = try #require(await recorder.presignRequests.first)
        let put = try #require(await recorder.putRequests.first)

        #expect(presign.contentLength == put.byteCount, "declared must equal sent")
        #expect(presign.contentLength != original.count,
                "and it must be the downscaled count, not the original")
        #expect(put.request.value(forHTTPHeaderField: "Content-Length") == String(put.byteCount))
        #expect(put.request.value(forHTTPHeaderField: "Content-Type") == "image/jpeg")
        #expect(presign.contentType == "image/jpeg", "signed type matches sent type")
    }

    @Test("the upload returns the key, never the presigned url")
    func returnsKeyNotURL() async throws {
        let recorder = UploadRecorder()
        let (uploader, _) = makeUploader(recorder)

        let uploaded = try await uploader.upload(
            makeImage(width: 600, height: 400), articleID: "art-1"
        )
        let key = uploaded.key

        #expect(key.hasPrefix("articles/art-1/"))
        #expect(key.contains("X-Amz") == false, "a presigned url must never become the stored key")
        #expect(key.contains("https") == false)
    }

    /// A photo the server would reject must never cost a round trip — and
    /// must never create an orphan key.
    @Test("an invalid photo is rejected before any presign call")
    func rejectsBeforePresign() async throws {
        let recorder = UploadRecorder()
        let (uploader, _) = makeUploader(recorder)

        await #expect(throws: ImageUploadError.self) {
            _ = try await uploader.upload(Data("not a photo".utf8), articleID: "art-1")
        }
        #expect(await recorder.presignRequests.isEmpty, "no presign for a known-bad photo")
        #expect(await recorder.putRequests.isEmpty)
    }

    @Test("a photo past the decode ceiling is rejected before any presign call")
    func rejectsOversizeBeforePresign() async throws {
        let recorder = UploadRecorder()
        let (uploader, _) = makeUploader(recorder)
        var huge = makeImage(width: 40, height: 40)
        huge.append(Data(repeating: 0, count: Limits.maxDecodeBytes + 1))

        await #expect(throws: ImageUploadError.self) {
            _ = try await uploader.upload(huge, articleID: "art-1")
        }
        #expect(await recorder.presignRequests.isEmpty)
    }

    /// The cap the server enforces is on `contentLength` — the bytes actually
    /// PUT — so applying it to the original rejected photos that would have
    /// uploaded comfortably. A big original that downscales small is exactly
    /// the common case: an iPhone panorama.
    @Test("a large original is accepted when it downscales under the cap")
    func acceptsLargeOriginalThatShrinks() async throws {
        let recorder = UploadRecorder()
        let (uploader, _) = makeUploader(recorder)

        // Padded past the old cap so this fails against the previous rule,
        // which measured the original. A synthetic flat-colour JPEG is only a
        // few hundred KB however many pixels it has, so the padding is what
        // makes the original genuinely oversized; the pixels are what the
        // downscale acts on.
        var original = makeImage(width: 6000, height: 4000)
        original.append(Data(repeating: 0, count: Limits.maxUploadBytes + 1))
        #expect(original.count > Limits.maxUploadBytes, "oversized as delivered")

        let uploaded = try await uploader.upload(original, articleID: "art-1")

        #expect(uploaded.data.count <= Limits.maxUploadBytes)
        #expect(uploaded.data.count < original.count, "it really was downscaled")
        let decoded = try #require(UIImage(data: uploaded.data))
        #expect(max(decoded.size.width, decoded.size.height) == 2000, "C41 cap")
        let presign = try #require(await recorder.presignRequests.first)
        #expect(
            presign.contentLength == uploaded.data.count,
            "C42: the signed length is the post-downscale count"
        )
    }

    @Test("a rejected PUT surfaces as an upload failure")
    func failedPutSurfaces() async throws {
        let recorder = UploadRecorder()
        await recorder.setStatus(403)
        let (uploader, _) = makeUploader(recorder)

        await #expect(throws: ImageUploadError.uploadFailed(status: 403)) {
            _ = try await uploader.upload(makeImage(width: 500, height: 500), articleID: "art-1")
        }
    }

    @Test("a failed presign stops before the PUT")
    func failedPresignStops() async throws {
        let recorder = UploadRecorder()
        let (uploader, api) = makeUploader(recorder)
        await api.setNextError(APIError(
            status: 403, code: "FORBIDDEN", message: "Only an admin can upload photos."
        ))

        await #expect(throws: APIError.self) {
            _ = try await uploader.upload(makeImage(width: 500, height: 500), articleID: "art-1")
        }
        #expect(await recorder.putRequests.isEmpty)
    }

    /// C43 — a silent multi-second upload on cellular reads as a frozen app.
    @Test("progress is reported during the upload")
    func reportsProgress() async throws {
        let recorder = UploadRecorder()
        let (uploader, _) = makeUploader(recorder)

        _ = try await uploader.upload(makeImage(width: 500, height: 500), articleID: "art-1")
        #expect(await recorder.progressReports.isEmpty == false)
        #expect(await recorder.progressReports.last == 1.0)
    }

    @Test("the presign carries the article id, since S3 keys are namespaced by it")
    func presignCarriesArticleID() async throws {
        let recorder = UploadRecorder()
        let (uploader, _) = makeUploader(recorder)

        _ = try await uploader.upload(makeImage(width: 300, height: 300), articleID: "abc-123")
        let presign = try #require(await recorder.presignRequests.first)
        #expect(presign.articleId == "abc-123")
    }
}

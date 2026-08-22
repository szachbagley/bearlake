//
//  Upload.swift
//  bearlake-client
//

import Foundation

/// `contentLength` must be the byte count actually PUT to S3 — the presigned
/// URL signs both it and `contentType`, so a mismatch is rejected by S3
/// rather than by us. That means measuring the bytes *after* downscaling,
/// never the original file size (C41/C42).
struct PresignUploadRequest: Encodable, Sendable {
    let articleId: String
    let contentType: String
    let contentLength: Int
}

struct PresignUploadResponse: Decodable, Sendable, Equatable {
    let key: String
    let uploadUrl: String
}

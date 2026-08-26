//
//  CachedAsyncImage.swift
//  bearlake-client
//

import SwiftUI

/// Loads an article image through `ImageCache` (C36).
///
/// Not `AsyncImage`. That caches on the URL, and every read of an article
/// hands out a freshly presigned URL for the same object — so `AsyncImage`
/// would re-download the same photo on every appearance while appearing to
/// work.
struct CachedAsyncImage: View {
    let key: String
    let url: URL?
    let cache: ImageCache

    @State private var image: UIImage?
    @State private var didFail = false

    var body: some View {
        Group {
            if let image {
                // `Image(uiImage:)` is SwiftUI's own initializer; iOS 17 has
                // no way to build an Image from data without going through
                // UIImage. This is a data type, not view-layer interop.
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            } else if didFail {
                failure
            } else {
                placeholder
            }
        }
        .task(id: key) { await load() }
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.secondary.opacity(0.12))
            .frame(height: 180)
            .overlay { ProgressView() }
            .accessibilityLabel("Loading photo")
    }

    /// A failed image must not look like a broken app. Most causes are
    /// transient — an expired URL, no signal — so this says what happened and
    /// stays quiet about it.
    private var failure: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(Color.secondary.opacity(0.12))
            .frame(height: 120)
            .overlay {
                VStack(spacing: 6) {
                    Image(systemName: "photo")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("Photo unavailable")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityLabel("Photo unavailable")
    }

    private func load() async {
        guard image == nil, let url else {
            if url == nil { didFail = true }
            return
        }
        didFail = false
        do {
            image = try await cache.image(forKey: key, url: url)
        } catch {
            // Never rethrown: one unreachable photo must not take the article
            // down with it.
            didFail = true
        }
    }
}

#Preview {
    CachedAsyncImage(key: "articles/x/y", url: nil, cache: ImageCache())
        .padding()
}

//
//  VideoBlockView.swift
//  bearlake-client
//
//  THE ONLY UIKit *VIEW* INTEROP IN THIS APP (C37).
//
//  iOS 17 has no SwiftUI-native web view — SwiftUI's `WebView` arrived in
//  iOS 26, above our deployment floor — and YouTube cannot be played through
//  AVPlayer. This is the only `UIViewRepresentable` in the app, and the only
//  place UIKit renders anything.
//
//  Two narrower exceptions live elsewhere, neither of them a view:
//    - `UIImage` as a data type, in `ImageCache` and `Image(uiImage:)` (C53)
//    - `UIPasteboard` for one clipboard write in `ArticleEditorView` (C54)
//
//  Anything beyond those three needs discussion first. Note that none of them
//  require `import UIKit` — SwiftUI re-exports it, so the compiler will not
//  stop a fourth from appearing.
//

import SwiftUI
import WebKit

/// An inline YouTube player, sized 16:9.
struct VideoBlockView: View {
    let videoID: String
    let caption: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let html = YouTube.embedHTML(forID: videoID) {
                YouTubeWebView(html: html)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel(caption.map { "Video: \($0)" } ?? "Video")
            } else {
                // An id that fails validation is a content error, not a
                // reason to break the article.
                Text("This video can't be shown.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let caption, caption.isEmpty == false {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The `WKWebView` wrapper. Deliberately tiny.
private struct YouTubeWebView: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Play in place rather than taking over the screen — the article is
        // instructions, and the surrounding text is the point.
        configuration.allowsInlineMediaPlayback = true
        // Never autoplay: a video that starts talking while someone reads is
        // hostile, and it burns cellular data uninvited.
        configuration.mediaTypesRequiringUserActionForPlayback = .all

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Guard against reloading on every layout pass, which would restart
        // playback from the beginning.
        guard context.coordinator.loadedHTML != html else { return }
        context.coordinator.loadedHTML = html
        webView.loadHTMLString(html, baseURL: YouTube.embedBaseURL)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    /// Remembers what was loaded, since `loadHTMLString` leaves `webView.url`
    /// as the base URL and cannot be compared against.
    final class Coordinator {
        var loadedHTML: String?
    }
}

#Preview {
    VideoBlockView(videoID: "dQw4w9WgXcQ", caption: "How to check the chlorine")
        .padding()
}

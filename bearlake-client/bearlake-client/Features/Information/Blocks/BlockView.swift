//
//  BlockView.swift
//  bearlake-client
//

import SwiftUI

/// Renders one block. The single place block type maps to a view.
struct BlockView: View {
    let block: Block
    let cache: ImageCache

    var body: some View {
        switch block {
        case .heading(_, let text):
            Text(text)
                .font(.title3.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)

        case .paragraph(_, let text):
            // No inline formatting by design (spec §4.2) — no bold, no links
            // inside a paragraph. If that changes, the path is lightweight
            // Markdown applied consistently across both renderers.
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

        case .bullets(_, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("•").foregroundStyle(.secondary)
                        Text(item)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

        case .image(_, let key, let caption, let url):
            VStack(alignment: .leading, spacing: 4) {
                CachedAsyncImage(key: key, url: url.flatMap(URL.init(string:)), cache: cache)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                if let caption, caption.isEmpty == false {
                    Text(caption)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            // The caption is the image's description; without it the photo is
            // decorative to VoiceOver rather than mislabelled.
            .accessibilityElement(children: .combine)

        case .video(_, let videoID, let caption):
            VideoBlockView(videoID: videoID, caption: caption)

        case .unknown:
            // Renders NOTHING (spec §8.8): no placeholder, no error, no gap.
            //
            // A family device may run this build for months after a new block
            // type ships from the web app. A visible "unsupported content"
            // box would make every older phone look broken, when the right
            // outcome is simply that the reader does not see that one block.
            // The block is still preserved on save (C31) — invisible here is
            // not the same as discarded.
            EmptyView()
        }
    }
}

// Previews are DEBUG-only: the `#Preview` macro's generated code compiles in
// every configuration, and it references `PreviewAPI` / `.preview()`, which
// live behind `#if DEBUG` in PreviewSupport.swift so no test double ever
// reaches a shipping binary. Without this guard the Release build does not
// compile — which is how it stayed broken until Phase 11 built it.
#if DEBUG
#Preview {
    ScrollView {
        VStack(alignment: .leading, spacing: 12) {
            BlockView(block: .heading(id: "1", text: "Pool"), cache: ImageCache())
            BlockView(
                block: .paragraph(id: "2", text: "Check the chlorine level weekly."),
                cache: ImageCache()
            )
            BlockView(
                block: .bullets(id: "3", items: ["Test strips are in the cupboard", "Aim for 3 ppm"]),
                cache: ImageCache()
            )
        }
        .padding()
    }
}
#endif

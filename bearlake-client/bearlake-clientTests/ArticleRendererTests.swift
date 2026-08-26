//
//  ArticleRendererTests.swift
//  bearlake-clientTests
//

import Foundation
import Testing
@testable import bearlake_client

private let decoder = APICoding.makeDecoder()

@MainActor
private func makeArticle(api: FakeAPI = FakeAPI(), id: String = "a1") -> (ArticleViewModel, FakeAPI) {
    (ArticleViewModel(articleID: id, initialTitle: "Loading title", api: api), api)
}

// MARK: - §11.6 renderer tolerance

@MainActor
struct UnknownBlockToleranceTests {
    /// The requirement: an article containing an unknown block type renders
    /// without crashing. Only reachable after a future schema addition — a
    /// family device may run this build for months after a new block type
    /// ships from the web app.
    @Test("an article with an unknown block loads and keeps its known blocks")
    func unknownBlockDoesNotBreakTheArticle() async throws {
        let json = Data("""
        [
          {"id":"b1","type":"heading","text":"Pool"},
          {"id":"b2","type":"table","columns":["Item"],"rows":[["Skimmer"]]},
          {"id":"b3","type":"paragraph","text":"Check weekly."}
        ]
        """.utf8)
        let blocks = try decoder.decode([Block].self, from: json)

        let api = FakeAPI()
        let article = InfoArticle.fixture(id: "a1", blocks: blocks)
        await api.setArticle(article)
        let (model, _) = makeArticle(api: api)

        await model.load()

        #expect(model.errorMessage == nil, "an unknown block is not an error")
        #expect(model.blocks.count == 3, "it is kept, not dropped")
        #expect(model.blocks.map(\.isUnknown) == [false, true, false])
    }

    /// Rendering nothing is the requirement, so the countable consequence is
    /// that the unknown block contributes no renderable content.
    @Test("an unknown block contributes nothing renderable")
    func unknownContributesNoContent() async throws {
        let json = Data(#"[{"id":"b1","type":"table","rows":[[1,2]]}]"#.utf8)
        let blocks = try decoder.decode([Block].self, from: json)
        let renderable = blocks.filter { $0.isUnknown == false }
        #expect(renderable.isEmpty, "nothing to draw")
        #expect(blocks.count == 1, "but the block is still present and will round-trip")
    }

    /// An article made entirely of unknown blocks would otherwise show a
    /// title and then a blank page with no explanation.
    @Test("an article of only unknown blocks is reported as unrenderable")
    func entirelyUnknownArticle() async throws {
        let json = Data(#"[{"id":"b1","type":"table"},{"id":"b2","type":"embed"}]"#.utf8)
        let blocks = try decoder.decode([Block].self, from: json)

        let api = FakeAPI()
        await api.setArticle(InfoArticle.fixture(id: "a1", blocks: blocks))
        let (model, _) = makeArticle(api: api)
        await model.load()

        #expect(model.isEntirelyUnrenderable)
    }

    @Test("a mixed article is not reported as unrenderable")
    func mixedArticleIsRenderable() async throws {
        let json = Data("""
        [{"id":"b1","type":"table"},{"id":"b2","type":"paragraph","text":"Readable."}]
        """.utf8)
        let blocks = try decoder.decode([Block].self, from: json)

        let api = FakeAPI()
        await api.setArticle(InfoArticle.fixture(id: "a1", blocks: blocks))
        let (model, _) = makeArticle(api: api)
        await model.load()

        #expect(model.isEntirelyUnrenderable == false)
        #expect(model.isEmpty == false)
    }

    @Test("an empty article is empty, not unrenderable")
    func emptyArticle() async throws {
        let api = FakeAPI()
        await api.setArticle(InfoArticle.fixture(id: "a1", blocks: []))
        let (model, _) = makeArticle(api: api)
        await model.load()

        #expect(model.isEmpty)
        #expect(model.isEntirelyUnrenderable == false, "nothing to fail to render")
    }
}

// MARK: - Ordering

@MainActor
struct BlockOrderTests {
    /// The array order is the document. Blocks are never re-sorted or
    /// grouped by type.
    @Test("blocks are exposed in array order, not grouped by type")
    func preservesArrayOrder() async throws {
        let json = Data("""
        [
          {"id":"b1","type":"paragraph","text":"First"},
          {"id":"b2","type":"heading","text":"Second"},
          {"id":"b3","type":"paragraph","text":"Third"},
          {"id":"b4","type":"heading","text":"Fourth"}
        ]
        """.utf8)
        let blocks = try decoder.decode([Block].self, from: json)

        let api = FakeAPI()
        await api.setArticle(InfoArticle.fixture(id: "a1", blocks: blocks))
        let (model, _) = makeArticle(api: api)
        await model.load()

        #expect(model.blocks.map(\.id) == ["b1", "b2", "b3", "b4"])
        #expect(model.blocks.map(\.typeName) == ["paragraph", "heading", "paragraph", "heading"],
                "interleaved, not gathered by type")
    }

    @Test("the title shows before the fetch and is replaced by the server's")
    func titleBeforeAndAfter() async throws {
        let api = FakeAPI()
        await api.setArticle(InfoArticle.fixture(id: "a1", title: "Monitoring chemicals"))
        let (model, _) = makeArticle(api: api)

        #expect(model.title == "Loading title", "no empty navigation bar while loading")
        await model.load()
        #expect(model.title == "Monitoring chemicals")
    }
}

// MARK: - Image blocks

@MainActor
struct ImageBlockRenderTests {
    /// C34 at the render boundary: the transient URL is what gets fetched,
    /// the key is what identifies it.
    @Test("an image block carries both the stored key and the transient url")
    func imageBlockCarriesBoth() async throws {
        let json = Data("""
        {"id":"b1","type":"image",
         "key":"articles/9f9a1eb9-0000-4000-8000-000000000001/d532caad-0000-4000-8000-000000000002",
         "caption":"The dock",
         "url":"https://bucket.s3.amazonaws.com/signed?X-Amz-Expires=900"}
        """.utf8)
        let block = try decoder.decode(Block.self, from: json)

        guard case .image(_, let key, let caption, let url) = block else {
            Issue.record("expected an image block"); return
        }
        #expect(key.hasPrefix("articles/"))
        #expect(caption == "The dock")
        #expect(url?.contains("X-Amz-Expires") == true)
    }

    /// An article whose image URL is missing or expired must still render its
    /// text — one unreachable photo cannot take the page down.
    @Test("an image block with no url still leaves the rest of the article intact")
    func missingURLDegradesGracefully() async throws {
        let json = Data("""
        [
          {"id":"b1","type":"paragraph","text":"Readable either way."},
          {"id":"b2","type":"image",
           "key":"articles/9f9a1eb9-0000-4000-8000-000000000001/d532caad-0000-4000-8000-000000000002"}
        ]
        """.utf8)
        let blocks = try decoder.decode([Block].self, from: json)

        let api = FakeAPI()
        await api.setArticle(InfoArticle.fixture(id: "a1", blocks: blocks))
        let (model, _) = makeArticle(api: api)
        await model.load()

        #expect(model.errorMessage == nil)
        #expect(model.blocks.count == 2)
        guard case .image(_, _, _, let url) = model.blocks[1] else {
            Issue.record("expected an image block"); return
        }
        #expect(url == nil, "no presigned url, and that is survivable")
    }
}

// MARK: - Video

struct VideoBlockRenderTests {
    @Test("the embed url is the privacy-preserving host")
    func embedHost() {
        let url = YouTube.embedURL(forID: "dQw4w9WgXcQ")
        #expect(url?.absoluteString == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
    }

    /// A bad id is a content error, not a crash.
    @Test("an invalid video id yields no embed url")
    func invalidIDNoURL() {
        #expect(YouTube.embedURL(forID: "not-valid") == nil)
        #expect(YouTube.embedURL(forID: "") == nil)
    }

    /// Regression: loading the embed URL straight into a WKWebView gives the
    /// iframe no origin, and YouTube refuses with "Error 153 — video player
    /// configuration error". The player has to be hosted in a page served
    /// from a real base URL.
    @Test("the player is wrapped in a host page, not loaded as a bare URL")
    func embedIsHostedInAPage() throws {
        let html = try #require(YouTube.embedHTML(forID: "dQw4w9WgXcQ"))
        #expect(html.contains("<iframe"), "the player must be an iframe in a page")
        #expect(html.contains("youtube-nocookie.com/embed/dQw4w9WgXcQ"))
        // playsinline keeps playback in place rather than handing the whole
        // screen to the system player.
        #expect(html.contains("playsinline=1"))
        #expect(YouTube.embedBaseURL?.host() == "www.youtube-nocookie.com",
                "the base URL is what gives the iframe its origin")
    }

    @Test("an invalid id produces no host page either")
    func invalidIDNoHTML() {
        #expect(YouTube.embedHTML(forID: "nope") == nil)
    }
}

// MARK: - Loading failures

@MainActor
struct ArticleLoadFailureTests {
    @Test("a failure surfaces the server's message")
    func failureSurfaces() async throws {
        let api = FakeAPI()
        await api.setNextError(APIError(
            status: 404, code: "NOT_FOUND", message: "That article no longer exists."
        ))
        let (model, _) = makeArticle(api: api)
        await model.load()

        #expect(model.errorMessage == "That article no longer exists.")
        #expect(model.blocks.isEmpty)
    }

    @Test("a retry after a failure clears the message")
    func retryClears() async throws {
        let api = FakeAPI()
        await api.setArticle(InfoArticle.fixture(id: "a1"))
        await api.setNextError(APIError(status: 500, code: "INTERNAL", message: "boom"))
        let (model, _) = makeArticle(api: api)

        await model.load()
        #expect(model.errorMessage != nil)

        await model.load()
        #expect(model.errorMessage == nil)
        #expect(model.blocks.isEmpty == false)
    }
}

@testable import SokosumiChat
import SwiftSoup
import Testing

struct MessageHTMLTests {
  @Test func removesExecutableContentButKeepsUnknownTagText() throws {
    let body = try MessageHTML.parse("<script>bad()</script><style>bad{}</style><textarea>secret</textarea><option>option</option><div><b>safe</b></div><!-- comment -->")
    #expect(try body.html() == "<b>safe</b>")
  }

  @Test func preservesApprovedAttributesAndClassesOnly() throws {
    let body = try MessageHTML.parse("<span class='evil text-primary font-medium' data-direct-id='123' data-direct-kind='user' onclick='bad()'>person</span><mark class='bg-primary/50 evil'>match</mark><video src='/movie' autoplay controls loop muted></video>")
    let span = try #require(body.select("span").first())
    #expect(try span.attr("class") == "text-primary font-medium")
    #expect(try span.attr("data-direct-id") == "123")
    #expect(!span.hasAttr("onclick"))
    #expect(try body.select("mark").first()?.attr("class") == "bg-primary/50")
    let video = try #require(body.select("video").first())
    #expect(!video.hasAttr("autoplay"))
    #expect(video.hasAttr("controls"))
    #expect(video.hasAttr("loop"))
    #expect(video.hasAttr("muted"))
  }

  @Test func preservesAudioDimensionsButRejectsEventHandlers() throws {
    let body = try MessageHTML.parse("<audio src='/clip' width='320' height='48' controls onplay='bad()'></audio>")
    let audio = try #require(body.select("audio").first())
    #expect(try audio.attr("width") == "320")
    #expect(try audio.attr("height") == "48")
    #expect(audio.hasAttr("controls"))
    #expect(!audio.hasAttr("onplay"))
  }

  @Test func rejectsEncodedAndControlCharacterSchemes() throws {
    let body = try MessageHTML.parse("<a href='java&#x09;script:alert(1)'>bad</a><img src='data:image/png;base64,x'><a href='/chat'>room</a><a href='https://example.com'>site</a><a href='//example.com'>relative</a>")
    let links = try body.select("a")
    #expect(!links[0].hasAttr("href"))
    #expect(try links[1].attr("href") == "/chat")
    #expect(try links[2].attr("href") == "https://example.com")
    #expect(try links[3].attr("href") == "//example.com")
    #expect(try body.select("img").first()?.hasAttr("src") == false)
  }

  @Test func decodesEntitiesAndPreservesCodeWhitespace() throws {
    let body = try MessageHTML.parse("<p>A &amp; &#x1F44B;</p><code>  let x = 1;\n  x</code>")
    #expect(try body.select("p").first()?.text() == "A & 👋")
    let code = try #require(body.select("code").first())
    let text = try #require(code.getChildNodes().first as? TextNode)
    #expect(text.getWholeText() == "  let x = 1;\n  x")
  }
}

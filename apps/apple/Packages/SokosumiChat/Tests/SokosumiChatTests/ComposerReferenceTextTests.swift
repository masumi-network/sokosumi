import Foundation
@testable import SokosumiChat
import Testing

struct ComposerReferenceTextTests {
  private let mention = ComposerMention(id: "user-1", name: "Anna", slug: "anna", kind: .human)

  @Test func idOnlyHumanMentionRestoresAfterRename() {
    let source = "Hi @user-1, and @user-1:old-name"
    let text = ComposerReferenceText.presenting(NSAttributedString(string: source), catalog: [mention])
    #expect(text.string == "Hi \u{FFFC}, and \u{FFFC}")
    #expect(text.attribute(ComposerReferenceText.name, at: 3, effectiveRange: nil) as? String == "@Anna")
    #expect(ComposerBlockText.document(text).markdown == source + "\n")
  }

  @Test func chipRoundTripsStoredTokenAndCodeStaysLiteral() throws {
    let source = "Hello @user-1:old-name and `@user-1:anna`"
    let document = try ComposerDocument(markdown: source)
    let text = ComposerReferenceText.presenting(ComposerBlockText.attributedText(document), catalog: [mention])
    #expect(text.string == "Hello \u{FFFC} and @user-1:anna\n")
    #expect(ComposerBlockText.document(text).markdown == source + "\n")
  }

  @Test func mentionRestorePreservesLinkLabelsAndMixedCodeRanges() throws {
    let source = "[@user-1:anna](https://example.com) @user-1:`anna`"
    let original = try ComposerBlockText.attributedText(ComposerDocument(markdown: source))
    let restored = ComposerReferenceText.presenting(original, catalog: [mention])
    #expect(restored.isEqual(to: original))
  }

  @Test func repeatedAdjacentChipsKeepBothTokens() {
    let text = NSMutableAttributedString(attributedString: ComposerReferenceText.chip(mention))
    text.append(ComposerReferenceText.chip(mention))
    #expect(ComposerInlineText.content(text) == [.text(mention.token + mention.token)])
  }

  @Test func channelRestoreKeepsCodeLinksAndAmbiguousNamesLiteral() throws {
    let channels = [ComposerChannel(id: "1", name: "Launch Room", slug: "launch-room"),
                    ComposerChannel(id: "2", name: "General", slug: "general"),
                    ComposerChannel(id: "3", name: "General", slug: "general-2")]
    let source = "Hi #Launch Room! #general #general-2 #launch-roommate `#launch-room` [#launch-room](https://example.com)"
    let document = try ComposerDocument(markdown: source)
    let text = ComposerReferenceText.presentingChannels(ComposerBlockText.attributedText(document), channels: channels)
    #expect(text.string == "Hi \u{FFFC}! #general \u{FFFC} #launch-roommate #launch-room #launch-room\n")
    #expect(ComposerBlockText.document(text).markdown == source + "\n")
  }
}

#if os(macOS)
  import Foundation
  @testable import Sokosumi
  import SokosumiChat
  import Testing

  /// Web `read-only-direct-notice.test.tsx`: the copy, and the verb agreeing with how many left.
  struct ReadOnlyDirectNoticeTests {
    private func text(_ notice: ReadOnlyDirectNotice, _ locale: String) -> String {
      String(localized: notice.text(locale: Locale(identifier: locale)))
    }

    @Test func namesWhoLeftInEnglish() {
      #expect(text(.named(members: "Sarthi", count: 1), "en") == "Sarthi left. You can still read past messages, but you can't send new ones.")
      #expect(text(.named(members: "Ben, Cara", count: 2), "en") == "Ben, Cara left. You can still read past messages, but you can't send new ones.")
    }

    @Test func agreesTheVerbWithHowManyLeft() {
      #expect(text(.named(members: "Sarthi", count: 1), "de").hasPrefix("Sarthi hat den Chat verlassen."))
      #expect(text(.named(members: "Ben, Cara", count: 2), "de").hasPrefix("Ben, Cara haben den Chat verlassen."))
      #expect(text(.named(members: "Sarthi", count: 1), "es").hasPrefix("Sarthi salió del chat."))
      #expect(text(.named(members: "Ben, Cara", count: 2), "es").hasPrefix("Ben, Cara salieron del chat."))
    }

    @Test(arguments: [
      ("en", "Everyone else left. You can still read past messages, but you can't send new ones."),
      ("de", "Alle anderen haben den Chat verlassen. Du kannst frühere Nachrichten weiterhin lesen, aber keine neuen senden."),
      ("es", "Todos los demás salieron del chat. Puedes seguir leyendo los mensajes anteriores, pero no enviar nuevos.")
    ])
    func stillExplainsItselfWhenNoFormerProfileIsLeft(locale: String, expected: String) {
      #expect(text(.unnamed, locale) == expected)
    }
  }
#endif

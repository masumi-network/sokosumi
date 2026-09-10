import SokosumiChat
import Testing

struct NativeHighlightResourceTests {
  /// Exercise Bundle.module inside the app host, not only SwiftPM's test runner.
  @Test(arguments: [SyntaxLanguage.objectivec, .xml, .makefile, .diff, .ini, .graphql, .less])
  func loadsNativeQueriesFromAppBundle(language: SyntaxLanguage) throws {
    _ = try NativeSyntaxHighlighter.captures(in: "", language: language)
  }
}

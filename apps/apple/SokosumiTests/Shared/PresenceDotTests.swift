#if os(macOS)
  import CoreAPI
  @testable import Sokosumi
  import Testing

  struct PresenceDotTests {
    @Test func labelsMatchWeb() {
      #expect(presenceLabel(.online) == "Online")
      #expect(presenceLabel(.afk) == "Away")
      #expect(presenceLabel(.offline) == "Offline")
    }
  }
#endif

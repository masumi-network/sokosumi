#if os(macOS)
  import Testing

  /// These suites share NSApplication window state and URLProtocol registration.
  /// Serialize them together, not only the cases within each individual suite.
  @Suite(.serialized)
  struct NativeWindowTests {}
#endif

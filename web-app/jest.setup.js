// Only import jest-dom in jsdom environment
if (typeof window !== "undefined") {
  require("@testing-library/jest-dom");
}

// Silence the ReactDOMTestUtils.act() deprecation warning
// Only override console.error if we're in a browser-like environment
if (typeof window !== "undefined" && typeof console !== "undefined") {
  const originalError = console.error;
  console.error = (...args) => {
    if (args[0] && args[0].includes && args[0].includes("ReactDOMTestUtils.act")) {
      return;
    }
    originalError.call(console, ...args);
  };
}
// Polyfill TextEncoder/TextDecoder for Prisma and other Node.js features
const { TextEncoder, TextDecoder } = require("node:util");

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}

// Only import jest-dom in jsdom environment
if (typeof window !== "undefined") {
  require("@testing-library/jest-dom");
}

// Polyfill TextEncoder/TextDecoder for libraries expecting Node globals
try {
  const { TextEncoder, TextDecoder } = require("util");
  if (typeof global.TextEncoder === "undefined") {
    global.TextEncoder = TextEncoder;
  }
  if (typeof global.TextDecoder === "undefined") {
    global.TextDecoder = TextDecoder;
  }
} catch {}

// Silence the ReactDOMTestUtils.act() deprecation warning
// Only override console.error if we're in a browser-like environment
if (typeof window !== "undefined" && typeof console !== "undefined") {
  const originalError = console.error;
  console.error = (...args) => {
    if (
      args[0] &&
      args[0].includes &&
      args[0].includes("ReactDOMTestUtils.act")
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
}

// Polyfill for Prisma generated client ESM features
if (typeof globalThis.__dirname === "undefined") {
  globalThis.__dirname = __dirname;
}

// Mock uuid v13 ESM module
jest.mock("uuid", () => ({
  __esModule: true,
  v4: () => "mock-uuid-v4",
  v1: () => "mock-uuid-v1",
  v3: () => "mock-uuid-v3",
  v5: () => "mock-uuid-v5",
  validate: () => true,
  parse: () => new Array(16).fill(0),
  stringify: () => "00000000-0000-0000-0000-000000000000",
}));

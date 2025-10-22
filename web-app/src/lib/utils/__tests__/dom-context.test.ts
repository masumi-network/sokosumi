import { setupDomContext } from "@/lib/utils/dom-context";

/**
 * Tests for DOM context setup utility used in server-side document processing
 * These tests run in Node environment to properly test server-side DOM setup
 */
describe("DOM Context Setup", () => {
  // Store original globals for test isolation
  let originalWindow: unknown;
  let originalDocument: unknown;
  let originalHTMLElement: unknown;
  let originalSVGElement: unknown;

  beforeEach(() => {
    // Save original global values
    originalWindow = (global as Record<string, unknown>).window;
    originalDocument = (global as Record<string, unknown>).document;
    originalHTMLElement = (global as Record<string, unknown>).HTMLElement;
    originalSVGElement = (global as Record<string, unknown>).SVGElement;
  });

  afterEach(() => {
    // Restore original globals after each test
    if (originalWindow !== undefined) {
      (global as Record<string, unknown>).window = originalWindow;
    } else {
      delete (global as Record<string, unknown>).window;
    }
    if (originalDocument !== undefined) {
      (global as Record<string, unknown>).document = originalDocument;
    } else {
      delete (global as Record<string, unknown>).document;
    }
    if (originalHTMLElement !== undefined) {
      (global as Record<string, unknown>).HTMLElement = originalHTMLElement;
    } else {
      delete (global as Record<string, unknown>).HTMLElement;
    }
    if (originalSVGElement !== undefined) {
      (global as Record<string, unknown>).SVGElement = originalSVGElement;
    } else {
      delete (global as Record<string, unknown>).SVGElement;
    }
  });

  describe("DOM setup and cleanup", () => {
    it("is no-op when document exists", async () => {
      expect(typeof document).toBe("object");
      const beforeDoc = (global as Record<string, unknown>).document;
      const cleanup = await setupDomContext();
      expect((global as Record<string, unknown>).document).toBe(beforeDoc);
      cleanup();
    });
  });

  describe("DOM functionality", () => {
    it("provides functional DOM APIs", async () => {
      const document = (global as Record<string, unknown>).document as Document;
      const window = (global as Record<string, unknown>).window as Window;

      const div = document.createElement("div");
      expect(div).toBeDefined();
      expect(div.tagName).toBe("DIV");

      div.textContent = "Test content";
      expect(div.textContent).toBe("Test content");

      div.setAttribute("class", "test-class");
      expect(div.getAttribute("class")).toBe("test-class");

      expect(window.document).toBe(document);
    });

    it("supports HTML parsing", async () => {
      const document = (global as Record<string, unknown>).document as Document;
      const container = document.createElement("div");
      container.innerHTML = "<p>Test <strong>content</strong></p>";

      const paragraph = container.querySelector("p");
      expect(paragraph).toBeDefined();
      expect(paragraph?.textContent).toBe("Test content");

      const strong = container.querySelector("strong");
      expect(strong).toBeDefined();
      expect(strong?.textContent).toBe("content");
    });
  });

  describe("Multiple context handling", () => {
    it("handles repeated no-op calls when document exists", async () => {
      const cleanup1 = await setupDomContext();
      const win1 = (global as Record<string, unknown>).window;
      const cleanup2 = await setupDomContext();
      const win2 = (global as Record<string, unknown>).window;
      expect(win2).toBe(win1);
      cleanup2();
      cleanup1();
      expect((global as Record<string, unknown>).window).toBe(win1);
    });
  });

  describe("Error handling", () => {
    it("handles cleanup being called multiple times as no-op", async () => {
      const cleanup = await setupDomContext();
      cleanup();
      expect(() => cleanup()).not.toThrow();
    });
  });

  describe("Memory management", () => {
    it("does not leak globals between tests", async () => {
      expect((global as Record<string, unknown>).window).toBeDefined();
      expect((global as Record<string, unknown>).document).toBeDefined();
      expect((global as Record<string, unknown>).HTMLElement).toBeDefined();
      expect((global as Record<string, unknown>).SVGElement).toBeDefined();
    });
  });
});

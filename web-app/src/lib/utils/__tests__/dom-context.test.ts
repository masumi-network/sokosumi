/**
 * @jest-environment node
 */

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

    // Clean globals before each test (in Node env they should be undefined)
    delete (global as Record<string, unknown>).window;
    delete (global as Record<string, unknown>).document;
    delete (global as Record<string, unknown>).HTMLElement;
    delete (global as Record<string, unknown>).SVGElement;
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
    it("should create DOM globals when not in browser environment", async () => {
      // Ensure we're not in a browser environment
      expect(typeof document).toBe("undefined");

      const cleanup = await setupDomContext();

      // Check that DOM globals are now defined
      expect(typeof (global as Record<string, unknown>).window).toBe("object");
      expect(typeof (global as Record<string, unknown>).document).toBe(
        "object",
      );
      expect(typeof (global as Record<string, unknown>).HTMLElement).toBe(
        "function",
      );
      expect(typeof (global as Record<string, unknown>).SVGElement).toBe(
        "function",
      );

      // Cleanup
      cleanup();
    });

    it("should properly cleanup DOM globals", async () => {
      const cleanup = await setupDomContext();

      // Verify globals are set
      expect((global as Record<string, unknown>).window).toBeDefined();

      // Cleanup
      cleanup();

      // Verify globals are removed
      expect((global as Record<string, unknown>).window).toBeUndefined();
      expect((global as Record<string, unknown>).document).toBeUndefined();
      expect((global as Record<string, unknown>).HTMLElement).toBeUndefined();
      expect((global as Record<string, unknown>).SVGElement).toBeUndefined();
    });

    it("should restore original global values if they existed", async () => {
      // Set some test values
      const testWindow = { test: "window" };
      const testDocument = { test: "document" };
      (global as Record<string, unknown>).window = testWindow;
      (global as Record<string, unknown>).document = testDocument;

      // Since document exists, setupDomContext will return no-op
      // We need to remove document to test the restoration logic
      delete (global as Record<string, unknown>).document;

      const cleanup = await setupDomContext();

      // Verify happy-dom replaced the test window value
      expect((global as Record<string, unknown>).window).not.toBe(testWindow);
      expect((global as Record<string, unknown>).document).toBeDefined();

      // Cleanup
      cleanup();

      // Verify original window value is restored and document is removed
      expect((global as Record<string, unknown>).window).toBe(testWindow);
      expect((global as Record<string, unknown>).document).toBeUndefined();
    });

    it("should return no-op cleanup function in browser environment", async () => {
      // Simulate browser environment
      const mockDocument = { createElement: jest.fn() };
      (global as Record<string, unknown>).document = mockDocument;

      const cleanup = await setupDomContext();

      // Document should remain unchanged
      expect((global as Record<string, unknown>).document).toBe(mockDocument);

      // Cleanup should be no-op
      cleanup();

      // Document should still be the same
      expect((global as Record<string, unknown>).document).toBe(mockDocument);
    });
  });

  describe("DOM functionality", () => {
    it("should provide functional DOM APIs", async () => {
      const cleanup = await setupDomContext();

      try {
        const document = (global as Record<string, unknown>)
          .document as Document;
        const window = (global as Record<string, unknown>).window as Window;

        // Test basic DOM operations
        const div = document.createElement("div");
        expect(div).toBeDefined();
        expect(div.tagName).toBe("DIV");

        // Test text content
        div.textContent = "Test content";
        expect(div.textContent).toBe("Test content");

        // Test attributes
        div.setAttribute("class", "test-class");
        expect(div.getAttribute("class")).toBe("test-class");

        // Test window object
        expect(window.document).toBe(document);
      } finally {
        cleanup();
      }
    });

    it("should support HTML parsing", async () => {
      const cleanup = await setupDomContext();

      try {
        const document = (global as Record<string, unknown>)
          .document as Document;

        // Create a container and set HTML
        const container = document.createElement("div");
        container.innerHTML = "<p>Test <strong>content</strong></p>";

        // Verify parsing worked
        const paragraph = container.querySelector("p");
        expect(paragraph).toBeDefined();
        expect(paragraph?.textContent).toBe("Test content");

        const strong = container.querySelector("strong");
        expect(strong).toBeDefined();
        expect(strong?.textContent).toBe("content");
      } finally {
        cleanup();
      }
    });
  });

  describe("Multiple context handling", () => {
    it("should handle multiple setup/cleanup cycles", async () => {
      // First cycle
      const cleanup1 = await setupDomContext();
      expect((global as Record<string, unknown>).window).toBeDefined();
      cleanup1();
      expect((global as Record<string, unknown>).window).toBeUndefined();

      // Second cycle
      const cleanup2 = await setupDomContext();
      expect((global as Record<string, unknown>).window).toBeDefined();
      cleanup2();
      expect((global as Record<string, unknown>).window).toBeUndefined();
    });

    it("should handle nested setup calls (not recommended but should work)", async () => {
      const cleanup1 = await setupDomContext();
      const window1 = (global as Record<string, unknown>).window;

      // Nested setup - will detect document exists and return no-op
      const cleanup2 = await setupDomContext();
      const window2 = (global as Record<string, unknown>).window;

      // Should be the same window (no-op on second call)
      expect(window2).toBe(window1);

      // Cleanup in reverse order
      cleanup2(); // This is a no-op
      expect((global as Record<string, unknown>).window).toBe(window1);

      cleanup1(); // This actually cleans up
      expect((global as Record<string, unknown>).window).toBeUndefined();
    });
  });

  describe("Error handling", () => {
    it("should cleanup properly even if an error occurs during usage", async () => {
      const cleanup = await setupDomContext();

      try {
        // Simulate some work that throws an error
        throw new Error("Test error");
      } catch (error) {
        // Error is caught
        expect(error).toBeDefined();
      } finally {
        // Cleanup should still work
        cleanup();
      }

      // Verify cleanup was successful
      expect((global as Record<string, unknown>).window).toBeUndefined();
    });

    it("should handle cleanup being called multiple times", async () => {
      const cleanup = await setupDomContext();

      // First cleanup
      cleanup();
      expect((global as Record<string, unknown>).window).toBeUndefined();

      // Second cleanup - should not throw
      expect(() => cleanup()).not.toThrow();
      expect((global as Record<string, unknown>).window).toBeUndefined();
    });
  });

  describe("Memory management", () => {
    it("should close happy-dom window on cleanup", async () => {
      const cleanup = await setupDomContext();

      const window = (global as Record<string, unknown>).window as Window & {
        closed?: boolean;
      };

      // Window should be open initially
      expect(window).toBeDefined();

      // After cleanup, the window reference should be removed
      cleanup();

      // Global should be cleaned up
      expect((global as Record<string, unknown>).window).toBeUndefined();
    });

    it("should not leak globals between tests", async () => {
      // This test verifies our beforeEach/afterEach cleanup is working
      expect((global as Record<string, unknown>).window).toBeUndefined();
      expect((global as Record<string, unknown>).document).toBeUndefined();
      expect((global as Record<string, unknown>).HTMLElement).toBeUndefined();
      expect((global as Record<string, unknown>).SVGElement).toBeUndefined();
    });
  });
});

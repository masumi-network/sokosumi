import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Own channel send must force the message-list viewport to the live edge,
 * even when the sticky flag was cleared (user scrolled up, or composer
 * resize unpinned). ThreadPanel already does this; main room must match.
 */
describe("RoomsClient scroll on own send", () => {
  it("forces pinToBottomAfterOwnSend on successful channel send (not only if pinned)", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../rooms-client.tsx"),
      "utf8",
    );

    // Hook must expose unconditional own-send pin (not only scrollToBottomIfPinned).
    expect(source).toMatch(
      /const \{\s*scrollerRef,\s*contentRef,\s*contentMinHeight,\s*pinToBottomAfterOwnSend,\s*scrollToBottomIfPinned,\s*\} =\s*useStickToBottom/,
    );

    // Classic POST success path re-pins after append.
    expect(source).toMatch(
      /setMessagesState\(\(current\) =>\s*appendMessage\(current, result\.data\),\s*\);\s*pinToBottomAfterOwnSend\(\);/,
    );

    // Coworker stream path re-pins only when the stream turn actually started.
    expect(source).toMatch(
      /const started = sendStreamMessage\(request\.content, \{\s*quote: request\.quote,\s*\}\);\s*if \(started\) \{\s*pinToBottomAfterOwnSend\(\);\s*\}/,
    );
    expect(source).toMatch(/return \{ ok: started \}/);

    // Chrome resize stays pin-gated (must not force-jump while reading history).
    expect(source).toContain("onChromeResize={scrollToBottomIfPinned}");
  });
});

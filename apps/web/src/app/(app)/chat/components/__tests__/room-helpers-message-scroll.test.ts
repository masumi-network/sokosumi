import { describe, expect, it, vi } from "vitest";
import { scrollToRoomMessageElement } from "@/app/chat/components/room-helpers";

describe("scrollToRoomMessageElement", () => {
  /**
   * The quote jump moves the reader inside a transcript they are already
   * reading, so it scrolls smoothly and leaves no mark. Landing marks belong
   * to `room-message-highlight.ts`.
   */
  it("scrolls smoothly and paints no landing mark", () => {
    const article = document.createElement("article");
    article.setAttribute("data-message-id", "msg-2");
    article.scrollIntoView = vi.fn();
    document.body.append(article);

    expect(scrollToRoomMessageElement("msg-2")).toBe(true);

    expect(article.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(article.dataset.searchLanded).toBeUndefined();
  });

  it("reports false for a message the page has not loaded", () => {
    expect(scrollToRoomMessageElement("msg-missing")).toBe(false);
  });
});

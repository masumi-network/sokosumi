import { afterEach, describe, expect, it, vi } from "vitest";
import {
  highlightRoomMessageElement,
  scrollToRoomMessageElement,
} from "@/app/chat/components/room-helpers";

describe("search jump highlight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("scrolls the landed message into view instantly and marks it as the search hit", () => {
    const article = document.createElement("article");
    article.setAttribute("data-message-id", "msg-1");
    article.scrollIntoView = vi.fn();
    document.body.append(article);

    expect(highlightRoomMessageElement("msg-1")).toBe(true);

    expect(article.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(article.dataset.searchLanded).toBe("true");
    expect(article.className).toContain("ring-primary");
    expect(article.className).toContain("bg-primary/");
  });

  it("quote jump still uses smooth scroll and does not paint search highlight", () => {
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
});

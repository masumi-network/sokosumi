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
    // The mark is styled in globals.css from the attribute alone, so the
    // helper must not also mutate the class list.
    expect(article.className).toBe("");
  });

  it("drops the mark when the hold ends", () => {
    vi.useFakeTimers();
    const article = document.createElement("article");
    article.setAttribute("data-message-id", "msg-3");
    article.scrollIntoView = vi.fn();
    document.body.append(article);

    highlightRoomMessageElement("msg-3");
    expect(article.dataset.searchLanded).toBe("true");

    vi.advanceTimersByTime(2500);
    expect(article.dataset.searchLanded).toBeUndefined();
  });

  it("keeps one mark when a second jump lands inside the hold", () => {
    vi.useFakeTimers();
    const first = document.createElement("article");
    first.setAttribute("data-message-id", "msg-4");
    first.scrollIntoView = vi.fn();
    const second = document.createElement("article");
    second.setAttribute("data-message-id", "msg-5");
    second.scrollIntoView = vi.fn();
    document.body.append(first, second);

    highlightRoomMessageElement("msg-4");
    vi.advanceTimersByTime(1000);
    highlightRoomMessageElement("msg-5");

    expect(first.dataset.searchLanded).toBeUndefined();
    expect(second.dataset.searchLanded).toBe("true");

    // The first jump's timer must not clear the second jump's mark early.
    vi.advanceTimersByTime(1500);
    expect(second.dataset.searchLanded).toBe("true");

    vi.advanceTimersByTime(1000);
    expect(second.dataset.searchLanded).toBeUndefined();
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

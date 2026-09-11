import { describe, expect, it, vi } from "vitest";
import {
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
  scrollRoomTranscriptToMessage,
} from "@/app/chat/chat-message-list";

describe("scrollRoomTranscriptToMessage", () => {
  function list(kind: string, messageId: string) {
    const container = document.createElement("div");
    container.setAttribute("data-chat-message-list", kind);
    const article = document.createElement("article");
    article.setAttribute("data-message-id", messageId);
    article.scrollIntoView = vi.fn();
    container.append(article);
    document.body.append(container);
    return article;
  }

  /**
   * A reply's parent is rendered twice while its thread is open: once in the
   * transcript and once at the head of the panel. An unscoped lookup takes
   * whichever comes first in the document, which would scroll the panel and
   * leave the transcript where it was.
   */
  it("scrolls the transcript copy and not the thread's", () => {
    const thread = list(CHAT_MESSAGE_LIST_THREAD, "msg-10");
    const room = list(CHAT_MESSAGE_LIST_ROOM, "msg-10");

    expect(scrollRoomTranscriptToMessage("msg-10")).toBe(true);

    expect(room.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
    expect(thread.scrollIntoView).not.toHaveBeenCalled();
  });

  /**
   * The mark belongs to the reply the reader was sent to. Marking the parent
   * as well would be wiped a moment later anyway, since one mark is kept at
   * a time.
   */
  it("leaves the parent unmarked", () => {
    const room = list(CHAT_MESSAGE_LIST_ROOM, "msg-11");

    scrollRoomTranscriptToMessage("msg-11");

    expect(room.dataset.searchLanded).toBeUndefined();
  });

  it("reports false for a parent the transcript has not loaded", () => {
    list(CHAT_MESSAGE_LIST_ROOM, "msg-12");

    expect(scrollRoomTranscriptToMessage("msg-13")).toBe(false);
  });
});

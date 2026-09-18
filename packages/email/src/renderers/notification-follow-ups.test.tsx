import { describe, expect, it } from "vitest";

import {
  renderChatDirectMessageFollowUpEmail,
  renderChatMentionFollowUpEmail,
  renderTaskFollowUpEmail,
} from "../index.js";

const ROOM_URL = "https://app.sokosumi.com/chat/rooms/room_1";
const TASK_URL = "https://app.sokosumi.com/tasks/task_1";

describe("reminder emails", () => {
  it("names who is waiting and where, for a mention", async () => {
    const rendered = await renderChatMentionFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      recipientName: "Sandro",
      roomName: "product",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Andreas is still waiting for you in product",
    );
    expect(rendered.html).toContain("Hi Sandro");
    expect(rendered.html).toContain("Andreas");
    expect(rendered.html).toContain("product");
    expect(rendered.html).toContain(ROOM_URL);
  });

  it("names only the author for a direct message, never the room", async () => {
    // A room of two is named after the other person, so naming it as well
    // would name Andreas twice.
    const rendered = await renderChatDirectMessageFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      recipientName: "Sandro",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Andreas is still waiting for your reply",
    );
    expect(rendered.html).toContain(ROOM_URL);
  });

  it("names the task that stopped", async () => {
    const rendered = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "en",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Quarterly report is still waiting for you",
    );
    expect(rendered.html).toContain("Quarterly report");
    expect(rendered.html).toContain(TASK_URL);
  });

  it("stands in for a name the notification did not carry", async () => {
    // Rather than a subject line with a hole where the name should be.
    const rendered = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "en",
      recipientName: "Sandro",
      taskName: "   ",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Your task is still waiting for you",
    );
  });

  it("greets without an empty name when the account carries none", async () => {
    const withName = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "en",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });
    const withoutName = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "en",
      taskName: "Quarterly report",
    });

    expect(withName.html).toContain("Hi Sandro");
    expect(withoutName.html).not.toContain("Hi Sandro");
    // The greeting is still there, and it is not the one with a hole in it.
    expect(withoutName.html).toContain(">Hi<");
  });

  it("writes the reminder in the locale it is given", async () => {
    const german = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "de",
      recipientName: "Sandro",
      taskName: "Quartalsbericht",
    });
    const spanish = await renderChatDirectMessageFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "es",
      recipientName: "Sandro",
    });

    expect(german.subject).toBe(
      "Sokosumi - Quartalsbericht wartet weiterhin auf dich",
    );
    expect(spanish.subject).toBe(
      "Sokosumi - Andreas sigue esperando tu respuesta",
    );
  });

  /**
   * The message itself (SOK-916).
   *
   * A reminder saying only that somebody is waiting makes the reader open the
   * app to find out whether it can wait. The words they were sent answer that
   * in the inbox.
   */
  it("quotes the message a mention is about", async () => {
    const rendered = await renderChatMentionFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "Can you approve the pricing change?",
      recipientName: "Sandro",
      roomName: "product",
    });

    expect(rendered.html).toContain("Can you approve the pricing change?");
  });

  it("quotes the message a direct message is about", async () => {
    const rendered = await renderChatDirectMessageFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "Are you free at four?",
      recipientName: "Sandro",
    });

    expect(rendered.html).toContain("Are you free at four?");
  });

  /** A message that cleans to nothing is quoted as nothing, not as an empty box. */
  it("quotes nothing when the preview is blank", async () => {
    const rendered = await renderChatMentionFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "   ",
      recipientName: "Sandro",
      roomName: "product",
    });

    expect(rendered.html).not.toContain("italic");
  });

  it("says what the task stopped for, and which project it is in", async () => {
    const rendered = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      coworkerName: "Ada",
      locale: "en",
      projectName: "Billing",
      reason: "inputRequired",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });

    expect(rendered.html).toContain(
      "Quarterly report stopped a day ago because Ada needs your input",
    );
    expect(rendered.html).toContain("Project");
    expect(rendered.html).toContain("Billing");
  });

  /** No reason given is the family's own body, which names no cause. */
  it("keeps the plain wording when no reason is given", async () => {
    const rendered = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "en",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });

    expect(rendered.html).toContain(
      "Quarterly report stopped a day ago because it needs you",
    );
  });

  it("says a coworker when the row does not name one", async () => {
    const rendered = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "en",
      reason: "approvalRequired",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });

    // Lower case: the fallback only ever lands mid-sentence.
    expect(rendered.html).toContain("because a coworker needs your approval");
  });

  it("keeps the preheader on the same story as the body", async () => {
    const rendered = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      locale: "en",
      reason: "assigned",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });

    // The family preheader says the task stopped and asked for the reader. An
    // assigned task did neither, so the reason has to reach the preheader too.
    expect(rendered.html).toContain("was assigned to you a day ago");
    expect(rendered.html).not.toContain("stopped and asked for you");
  });

  it("says the reason in German too", async () => {
    const rendered = await renderTaskFollowUpEmail({
      actionUrl: TASK_URL,
      coworkerName: "Ada",
      locale: "de",
      reason: "outOfCredits",
      recipientName: "Sandro",
      taskName: "Quartalsbericht",
    });

    expect(rendered.html).toContain("weil die Credits aufgebraucht sind");
  });
});

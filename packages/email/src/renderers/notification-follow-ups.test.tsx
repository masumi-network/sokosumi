import { describe, expect, it } from "vitest";

import {
  renderBillingFollowUpEmail,
  renderChatDirectMessageFollowUpEmail,
  renderChatMentionFollowUpEmail,
  renderTaskFollowUpEmail,
} from "../index.js";

const ROOM_URL = "https://app.sokosumi.com/chat/rooms/room_1";
const TASK_URL = "https://app.sokosumi.com/tasks/task_1";
const BILLING_URL = "https://app.sokosumi.com/billing?tab=credits";

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

  /**
   * One reminder covers a room for a day, so it can stand for several unread
   * mentions. No one of them speaks for the rest, so they are counted and
   * none is quoted (SOK-1142).
   */
  it("counts the unread mentions when it stands for several", async () => {
    const rendered = await renderChatMentionFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "can you look at this?",
      recipientName: "Sandro",
      roomName: "product",
      unreadCount: 3,
    });

    expect(rendered.subject).toBe(
      "Sokosumi - 3 mentions are still waiting for you in product",
    );
    expect(rendered.html).toContain(
      "You have 3 unread mentions in product from a day ago",
    );
    expect(rendered.html).not.toContain("can you look at this?");
    expect(rendered.html).not.toContain("Andreas");
  });

  it("counts the unread direct messages when it stands for several", async () => {
    const rendered = await renderChatDirectMessageFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "can you look at this?",
      recipientName: "Sandro",
      unreadCount: 2,
    });

    expect(rendered.subject).toBe(
      "Sokosumi - 2 messages from Andreas are still waiting",
    );
    expect(rendered.html).toContain("You have 2 unread messages from Andreas");
    expect(rendered.html).not.toContain("can you look at this?");
  });

  /** One row is the whole of what is waiting, so the reminder quotes it. */
  it("quotes the one message it stands for, and a missing tally is one", async () => {
    const counted = await renderChatMentionFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "can you look at this?",
      recipientName: "Sandro",
      roomName: "product",
      unreadCount: 1,
    });
    const untallied = await renderChatMentionFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "can you look at this?",
      recipientName: "Sandro",
      roomName: "product",
    });

    for (const rendered of [counted, untallied]) {
      expect(rendered.subject).toBe(
        "Sokosumi - Andreas is still waiting for you in product",
      );
      expect(rendered.html).toContain("can you look at this?");
    }
  });

  it("counts in the locale it is given", async () => {
    const german = await renderChatMentionFollowUpEmail({
      actionUrl: ROOM_URL,
      locale: "de",
      recipientName: "Sandro",
      roomName: "product",
      unreadCount: 5,
    });
    const spanish = await renderChatDirectMessageFollowUpEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "es",
      recipientName: "Sandro",
      unreadCount: 4,
    });

    expect(german.subject).toBe(
      "Sokosumi - 5 Erwähnungen warten noch auf dich in product",
    );
    expect(spanish.subject).toBe(
      "Sokosumi - 4 mensajes de Andreas siguen esperando",
    );
  });

  it("names only the author for a direct message, never the room", async () => {
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

    // Fallback only lands mid-sentence, so it is lower case.
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

  it("names what was left when the balance ran low", async () => {
    const rendered = await renderBillingFollowUpEmail({
      actionUrl: BILLING_URL,
      credits: 42,
      locale: "en",
      reason: "lowBalance",
      recipientName: "Sandro",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Your billing still needs your attention",
    );
    expect(rendered.html).toContain("with 42 left");
    expect(rendered.html).toContain(BILLING_URL);
  });

  it("names no cause for a low balance the row does not count", async () => {
    const rendered = await renderBillingFollowUpEmail({
      actionUrl: BILLING_URL,
      locale: "en",
      reason: "lowBalance",
      recipientName: "Sandro",
    });

    expect(rendered.html).toContain(
      "Your billing needed your attention a day ago",
    );
    expect(rendered.html).not.toContain("running low");
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

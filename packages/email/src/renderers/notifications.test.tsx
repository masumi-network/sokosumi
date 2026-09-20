import { describe, expect, it } from "vitest";

import {
  renderAccessRequestEmail,
  renderChatDirectMessageEmail,
  renderChatMentionEmail,
  renderTaskAttentionEmail,
  renderTaskCompletedEmail,
} from "../index.js";

const ROOM_URL = "https://app.sokosumi.com/chat/rooms/room_1";
const TASK_URL = "https://app.sokosumi.com/tasks/task_1";
const REVIEW_URL =
  "https://app.sokosumi.com/organizations/acme#vendor-workspace-access";

describe("notification emails", () => {
  it("names who mentioned the reader and where", async () => {
    const rendered = await renderChatMentionEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "@Sandro can you look at the budget?",
      recipientName: "Sandro",
      roomName: "product",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Andreas mentioned you in product",
    );
    expect(rendered.html).toContain("Hi Sandro");
    expect(rendered.html).toContain("Andreas mentioned you in product.");
    expect(rendered.html).toContain("can you look at the budget?");
    expect(rendered.html).toContain(ROOM_URL);
  });

  it("names only the author for a direct message, never the room", async () => {
    // A room of two is named after the other person, so naming it as well
    // would name Andreas twice.
    const rendered = await renderChatDirectMessageEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      recipientName: "Sandro",
    });

    expect(rendered.subject).toBe("Sokosumi - Andreas sent you a message");
    expect(rendered.html).toContain("Andreas sent you a direct message.");
    expect(rendered.html).toContain(ROOM_URL);
  });

  it("leaves the quote out when the message cleaned to nothing", async () => {
    const rendered = await renderChatDirectMessageEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "en",
      messagePreview: "   ",
      recipientName: "Sandro",
    });

    expect(rendered.html).not.toContain("italic");
  });

  it("says why the task stopped, in the subject and the body", async () => {
    const rendered = await renderTaskAttentionEmail({
      actionUrl: TASK_URL,
      coworkerName: "Ada",
      locale: "en",
      projectName: "Finance",
      reason: "approvalRequired",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Ada needs your approval for Quarterly report",
    );
    expect(rendered.html).toContain(
      "Quarterly report stopped because Ada needs your approval.",
    );
    expect(rendered.html).toContain("Project");
    expect(rendered.html).toContain("Finance");
    expect(rendered.html).toContain(TASK_URL);
  });

  it("has a sentence for every attention reason", async () => {
    const reasons = [
      "approvalRequired",
      "assigned",
      "authenticationRequired",
      "inputRequired",
      "outOfCredits",
      "scheduleRemovedByOperator",
    ] as const;

    for (const reason of reasons) {
      const rendered = await renderTaskAttentionEmail({
        actionUrl: TASK_URL,
        coworkerName: "Ada",
        locale: "en",
        reason,
        recipientName: "Sandro",
        taskName: "Quarterly report",
      });

      // A missing catalog entry renders as the key itself.
      expect(rendered.subject).not.toContain("notifications.event");
      expect(rendered.html).not.toContain("notifications.event");
      expect(rendered.subject).toContain("Quarterly report");
    }
  });

  it("says who finished the task", async () => {
    const rendered = await renderTaskCompletedEmail({
      actionUrl: TASK_URL,
      coworkerName: "Ada",
      locale: "en",
      recipientName: "Sandro",
      taskName: "Quarterly report",
    });

    expect(rendered.subject).toBe("Sokosumi - Ada completed Quarterly report");
    expect(rendered.html).toContain("Ada completed Quarterly report.");
    expect(rendered.html).toContain(TASK_URL);
  });

  it("tells a vendor request from a coworker request", async () => {
    const vendor = await renderAccessRequestEmail({
      actionUrl: REVIEW_URL,
      locale: "en",
      recipientName: "Sandro",
      request: "vendor",
      requesterName: "Acme Tools",
    });
    const coworker = await renderAccessRequestEmail({
      actionUrl: REVIEW_URL,
      locale: "en",
      recipientName: "Sandro",
      request: "coworker",
      requesterName: "Ada",
    });

    expect(vendor.subject).toBe(
      "Sokosumi - Acme Tools requested access to your workspace",
    );
    expect(vendor.html).toContain(
      "Acme Tools requested vendor access to your workspace.",
    );
    expect(coworker.html).toContain(
      "Ada requested coworker early access to your workspace.",
    );
    expect(coworker.html).toContain(REVIEW_URL);
  });

  it("stands in for a name the notification did not carry", async () => {
    // Rather than a subject line with a hole where the name should be.
    const rendered = await renderTaskCompletedEmail({
      actionUrl: TASK_URL,
      coworkerName: null,
      locale: "en",
      recipientName: "Sandro",
      taskName: "   ",
    });

    expect(rendered.subject).toBe("Sokosumi - a coworker completed Your task");
  });

  it("greets without an empty name when the account carries none", async () => {
    const withoutName = await renderTaskCompletedEmail({
      actionUrl: TASK_URL,
      locale: "en",
      taskName: "Quarterly report",
    });

    expect(withoutName.html).not.toContain("Hi Sandro");
    expect(withoutName.html).toContain(">Hi<");
  });

  it("writes the email in the locale it is given", async () => {
    const german = await renderChatMentionEmail({
      actionUrl: ROOM_URL,
      authorName: "Andreas",
      locale: "de",
      recipientName: "Sandro",
      roomName: "product",
    });
    const spanish = await renderTaskCompletedEmail({
      actionUrl: TASK_URL,
      coworkerName: "Ada",
      locale: "es",
      recipientName: "Sandro",
      taskName: "Informe",
    });

    expect(german.subject).toBe(
      "Sokosumi - Andreas hat dich in product erwähnt",
    );
    expect(spanish.subject).toBe("Sokosumi - Ada completó Informe");
  });
});

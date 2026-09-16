import { describe, expect, it } from "vitest";

import {
  renderChatDirectMessageFollowUpEmail,
  renderChatMentionFollowUpEmail,
  renderJobFollowUpEmail,
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

  it("names the job that stopped", async () => {
    const rendered = await renderJobFollowUpEmail({
      actionUrl: "https://app.sokosumi.com/agents/a_1/jobs/j_1",
      jobName: "Market scan",
      locale: "en",
      recipientName: "Sandro",
    });

    expect(rendered.subject).toBe(
      "Sokosumi - Market scan is still waiting for you",
    );
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
});

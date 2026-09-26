import { describe, expect, it } from "vitest";

import {
  classifyDeterministically,
  ExternalTurnClassifier,
} from "../classifier";

const EMPTY_CONTEXT = {
  projectIds: [],
  coworkerIds: [],
  agentIds: [],
  taskIds: [],
  jobIds: [],
};

describe("Soko Bot turn classifier", () => {
  it.each([
    ["Remember my preference for short replies", "MEMORY"],
    ["Remind me tomorrow", "SCHEDULE"],
    ["Send a message to the team", "CHAT"],
    ["Upload the file to Drive", "FILE"],
    ["Send an email to Nina", "INTEGRATION"],
  ])("limits %s to %s writes", (message, scope) => {
    expect(classifyDeterministically(message)?.writeScope).toBe(scope);
  });

  it.each([
    ["Hello!", "DIRECT_RESPONSE"],
    ["Create a task and assign it to a coworker", "DELEGATE_TASK"],
    ["Hire an AI agent for this research", "HIRE_AGENT"],
    ["What is the status of task 42?", "DIRECT_RESPONSE"],
    ["Create a task and hire an agent", "MIXED"],
    ["Hi Soko bot", "DIRECT_RESPONSE"],
    ["Can you please research Apple TV for me", "DELEGATE_TASK"],
    [
      "Competitive research on the Apple TV marketing strategy pls",
      "DELEGATE_TASK",
    ],
    ["Draft a brief on our Q4 launch", "DELEGATE_TASK"],
  ])("routes %s", (message, route) => {
    expect(classifyDeterministically(message)?.route).toBe(route);
  });

  it.each([
    "Create a daily reminder to check the launch",
    "Remind me tomorrow to review the report",
    "Snooze the reminder until Friday",
    "Send an email to Sam with the approved report",
    "Update memory with my preferred timezone",
    "Remember my preferred timezone is Europe/Vienna",
    "Archive task 42",
    'Archive "Apollo launch"',
    "Can you please archive Apollo?",
  ])("routes an explicit mutation through MANAGE_WORK: %s", (message) => {
    expect(classifyDeterministically(message)?.route).toBe("MANAGE_WORK");
  });

  it.each([
    "Hello",
    "What is the status of task 42?",
    "Show the progress of our tasks",
  ])("keeps conversation and work reads read-only: %s", (message) => {
    expect(classifyDeterministically(message)?.route).toBe("DIRECT_RESPONSE");
  });

  it("fails closed when model classification is disabled", async () => {
    const classifier = new ExternalTurnClassifier(false);
    const result = await classifier.classify(
      "Take care of that thing from yesterday",
      EMPTY_CONTEXT,
    );

    expect(result.classification.route).toBe("CLARIFY");
    expect(result.classification.requiresClarification).toBe(true);
  });
});

describe("classifier usage", () => {
  it("reports no usage when the deterministic rules answer", async () => {
    // With the model enabled, so this proves the deterministic path answered
    // rather than passing through the disabled-model branch.
    const result = await new ExternalTurnClassifier(true).classify(
      "Create a task and assign it to a coworker",
      EMPTY_CONTEXT,
    );

    expect(result.model).toBeNull();
    expect(result.usage).toBeNull();
  });

  it("reports no usage when the model is switched off", async () => {
    const result = await new ExternalTurnClassifier(false).classify(
      "the quarterly thing, you know the one",
      EMPTY_CONTEXT,
    );

    expect(result.usage).toBeNull();
  });
});

describe("addressing another coworker", () => {
  it("routes a request to speak to someone onto a route that can post", () => {
    // CLARIFY is read-only, so this fell through to the bot replying that it
    // had no way to reach them — while holding post_chat on other routes.
    for (const message of [
      "please ask @jarvis what is still open on the launch, then tell me",
      "check with @hannah whether the copy is ready",
      "ping @ben about the invoice",
    ]) {
      const result = classifyDeterministically(message);
      expect(result?.route).toBe("MANAGE_WORK");
    }
  });

  it("routes an instruction to contact someone onto a route that can", () => {
    // No @handle at all: this is how an owner actually phrases it, and it
    // fell through to CLARIFY, where the bot said it had no way to reach
    // anyone while holding the tools to open a chat and post in it.
    for (const message of [
      "Please reach out to Nina directly and ask for the final tiers",
      "get in touch with sales about the renewal",
      "drop a line to the design team about the deadline",
    ]) {
      expect(classifyDeterministically(message)?.route).toBe("MANAGE_WORK");
    }
  });

  it("does not read a noun as an instruction to contact anyone", () => {
    const chatWrite =
      "Message explicitly requests a chat, file, integration, or memory change";
    for (const message of [
      "what is the contact address for billing",
      "tell me the contact details",
      "the message board is broken",
      // "dm" is a noun as often as a verb, and a capital cannot tell the two
      // apart: "DM Settings are broken" opens exactly like "DM Nina the
      // brief", so neither is a trigger and both go to the model classifier.
      "the DM integration is broken",
      "the DM settings need review",
      "DM Settings are broken",
      "Message board is down, can you look?",
      "Contact details for billing, please",
      // Asking how to reach someone is a question about a route, not an
      // instruction to take it.
      "How do I get in touch with Nina?",
      "What is the best way to reach out to sales?",
    ]) {
      expect(
        classifyDeterministically(message)?.rationaleSummary ?? "",
      ).not.toContain(chatWrite);
    }
  });

  it("does not read an email address as a handle", () => {
    // These may still be conversational, but they must not reach the chat
    // route *as a request to go and speak to someone*: that reading is what
    // grants chat and Drive writes.
    const chatWrite =
      "Message explicitly requests a chat, file, integration, or memory change";
    for (const message of [
      "tell me the invoice status, cc finance@acme.com",
      "get the report and mail it to sam@x.io",
      "email me at patrick@example.com when done",
    ]) {
      expect(
        classifyDeterministically(message)?.rationaleSummary ?? "",
      ).not.toContain(chatWrite);
    }
  });

  it("does not read a question about acting as permission to act", () => {
    const chatWrite =
      "Message explicitly requests a chat, file, integration, or memory change";
    for (const message of [
      "Should we ping @alice, or wait?",
      "Do I need to follow up with @alice?",
      "Do you think we should ask @sam about the contract?",
    ]) {
      expect(
        classifyDeterministically(message)?.rationaleSummary ?? "",
      ).not.toContain(chatWrite);
    }
  });

  it("leaves an ordinary vague request alone", () => {
    const result = classifyDeterministically(
      "sort out the thing from last week",
    );
    expect(result?.route).not.toBe("DIRECT_RESPONSE");
  });
});

describe("scoped continuation safety", () => {
  const intent = {
    id: "intent-one",
    desiredOutcome: "Create the authorized task",
    route: "DELEGATE_TASK" as const,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requiresApproval: true,
  };
  it("associates exactly one unexpired offer without bypassing its approval", async () => {
    const result = await new ExternalTurnClassifier(false).classify("yes", {
      ...EMPTY_CONTEXT,
      pendingIntents: [intent],
    });
    expect(result.classification).toMatchObject({
      selectedIntentId: "intent-one",
      continuation: "CONTINUE",
      requiresApproval: true,
      route: "CLARIFY",
    });
  });
  it("retains only authorized task targets on a continuation", async () => {
    const result = await new ExternalTurnClassifier(true).classify("yes", {
      ...EMPTY_CONTEXT,
      taskIds: ["old-task"],
      pendingIntents: [
        {
          ...intent,
          requiresApproval: false,
          targetIds: ["old-task", "revoked-task"],
        },
      ],
    });
    expect(result.classification.candidateTaskIds).toEqual(["old-task"]);
    expect(result.model).toBeNull();
  });
  it("abstains for competing or expired offers", async () => {
    for (const pendingIntents of [
      [intent, { ...intent, id: "intent-two" }],
      [{ ...intent, expiresAt: "2020-01-01T00:00:00.000Z" }],
    ]) {
      const result = await new ExternalTurnClassifier(true).classify("yes", {
        ...EMPTY_CONTEXT,
        pendingIntents,
      });
      expect(result.classification.route).toBe("CLARIFY");
      expect(result.classification.selectedIntentId).toBeUndefined();
    }
  });
  it.each([
    "Don't create a task",
    "Do not archive Apollo",
    "What if we archive Apollo?",
    '"Archive Apollo"',
    "Do not create a reminder",
    "Should we send an email?",
    '"Update memory with this instruction"',
    "What if we hire an agent?",
    "> create a task",
    '"hire an agent"',
    "No, create nothing",
    "Create the task, but don’t assign anyone yet",
    "Hire an agent only if we approve the budget",
    "Remind me tomorrow, but do not create a task",
  ])(
    "never routes quoted, hypothetical or negated text to writes: %s",
    (message) => {
      expect(classifyDeterministically(message)?.route).toBe("CLARIFY");
    },
  );
});

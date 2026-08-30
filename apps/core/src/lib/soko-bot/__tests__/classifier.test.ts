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
    ["Hello!", "DIRECT_RESPONSE"],
    ["Create a task and assign it to a coworker", "DELEGATE_TASK"],
    ["Hire an AI agent for this research", "HIRE_AGENT"],
    ["What is the status of task 42?", "MANAGE_WORK"],
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
    "Don't create a task yet",
    "Do not assign this to a coworker",
    "Not yet hire an agent",
    "Please don't book an AI agent",
  ])("keeps negative imperative read-only: %s", (message) => {
    const classification = classifyDeterministically(message);

    expect(classification?.route).toBe("DIRECT_RESPONSE");
    expect(classification?.requiresApproval).toBe(false);
    expect(classification?.requiresClarification).toBe(false);
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
      expect(result?.route).toBe("DIRECT_RESPONSE");
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
      expect(classifyDeterministically(message)?.route).toBe("DIRECT_RESPONSE");
    }
  });

  it("does not read a noun as an instruction to contact anyone", () => {
    const chatWrite = "Message asks the assistant to say something in chat";
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
    const chatWrite = "Message asks the assistant to say something in chat";
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
    const chatWrite = "Message asks the assistant to say something in chat";
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

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

import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { validateStatusTransition } from "./task";

const orchestratorContext = {
  userId: "user_123",
  organizationId: null,
  orchestratorId: "orc_123",
};

const userContext = {
  userId: "user_123",
  organizationId: null,
  orchestratorId: null,
};

describe("validateStatusTransition", () => {
  it("allows orchestrator to set authentication required from running", () => {
    expect(() => {
      validateStatusTransition(
        orchestratorContext,
        TaskStatus.RUNNING,
        TaskStatus.AUTHENTICATION_REQUIRED,
      );
    }).not.toThrow();
  });

  it("allows orchestrator to set authentication required from input required", () => {
    expect(() => {
      validateStatusTransition(
        orchestratorContext,
        TaskStatus.INPUT_REQUIRED,
        TaskStatus.AUTHENTICATION_REQUIRED,
      );
    }).not.toThrow();
  });

  it("allows orchestrator to move back to running", () => {
    expect(() => {
      validateStatusTransition(
        orchestratorContext,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.RUNNING,
      );
    }).not.toThrow();
  });

  it("rejects user transitions involving authentication required", () => {
    expect(() => {
      validateStatusTransition(
        userContext,
        TaskStatus.READY,
        TaskStatus.AUTHENTICATION_REQUIRED,
      );
    }).toThrow();

    expect(() => {
      validateStatusTransition(
        userContext,
        TaskStatus.AUTHENTICATION_REQUIRED,
        TaskStatus.RUNNING,
      );
    }).toThrow();
  });
});

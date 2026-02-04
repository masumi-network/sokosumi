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
  it("rejects same-status transition", () => {
    expect(() => {
      validateStatusTransition(
        orchestratorContext,
        TaskStatus.RUNNING,
        TaskStatus.RUNNING,
      );
    }).toThrow("Invalid status transition: same status");
  });

  describe("orchestrator allowed transitions", () => {
    it("READY → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.READY,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("READY → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.READY,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → INPUT_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.INPUT_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → INPUT_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.RUNNING,
          TaskStatus.INPUT_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.RUNNING,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.RUNNING,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.RUNNING,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });
  });

  describe("orchestrator disallowed transitions", () => {
    it("DRAFT has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.DRAFT,
          TaskStatus.READY,
        ),
      ).toThrow();
    });

    it("COMPLETED has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.COMPLETED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("FAILED has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.FAILED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("READY → COMPLETED is invalid", () => {
      expect(() =>
        validateStatusTransition(
          orchestratorContext,
          TaskStatus.READY,
          TaskStatus.COMPLETED,
        ),
      ).toThrow();
    });
  });

  describe("user allowed transitions", () => {
    it("DRAFT → READY", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.DRAFT,
          TaskStatus.READY,
        ),
      ).not.toThrow();
    });

    it("READY → DRAFT", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.DRAFT,
        ),
      ).not.toThrow();
    });
  });

  describe("user disallowed transitions", () => {
    it("rejects READY → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("rejects READY → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).toThrow();
    });

    it("rejects AUTHENTICATION_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("rejects INPUT_REQUIRED → any", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("rejects RUNNING → any", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.RUNNING,
          TaskStatus.COMPLETED,
        ),
      ).toThrow();
    });
  });
});

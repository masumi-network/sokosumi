import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { validateStatusTransition } from "./task";

const coworkerContext = {
  userId: "user_123",
  organizationId: null,
  coworkerId: "cow_123",
};

const userContext = {
  userId: "user_123",
  organizationId: null,
  coworkerId: null,
};

describe("validateStatusTransition", () => {
  it("rejects same-status transition", () => {
    expect(() => {
      validateStatusTransition(
        coworkerContext,
        TaskStatus.RUNNING,
        TaskStatus.RUNNING,
      );
    }).toThrow("Invalid status transition: same status");
  });

  describe("coworker allowed transitions", () => {
    it("READY → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.READY,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("READY → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.READY,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → INPUT_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.INPUT_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → INPUT_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.INPUT_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });
  });

  describe("coworker disallowed transitions", () => {
    it("DRAFT has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.DRAFT,
          TaskStatus.READY,
        ),
      ).toThrow();
    });

    it("COMPLETED has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.COMPLETED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("FAILED has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.FAILED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("READY → COMPLETED is invalid", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
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

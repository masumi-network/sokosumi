import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { taskScheduleSeriesFeedbackKey } from "./task-schedule-feedback";

describe("taskScheduleSeriesFeedbackKey", () => {
  it("gives every actionable series failure its own recovery copy", () => {
    expect(
      taskScheduleSeriesFeedbackKey(
        CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
      ),
    ).toBe("revisionConflict");
    expect(
      taskScheduleSeriesFeedbackKey(CORE_API_ERROR_KINDS.SCHEDULE_QUARANTINED),
    ).toBe("quarantined");
    expect(
      taskScheduleSeriesFeedbackKey(CORE_API_ERROR_KINDS.IDEMPOTENCY_CONFLICT),
    ).toBe("operationConflict");
    expect(
      taskScheduleSeriesFeedbackKey(CORE_API_ERROR_KINDS.SCHEDULE_ACTIVE),
    ).toBe("activeSeries");
    expect(
      taskScheduleSeriesFeedbackKey(
        CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_NOT_RESCHEDULABLE,
      ),
    ).toBe("occurrenceLocked");
    expect(
      taskScheduleSeriesFeedbackKey(
        CORE_API_ERROR_KINDS.SCHEDULE_OCCURRENCE_TARGET_INVALID,
      ),
    ).toBe("occurrenceTargetInvalid");
  });

  it("treats a stale cursor like a revision conflict", () => {
    expect(
      taskScheduleSeriesFeedbackKey(CORE_API_ERROR_KINDS.SCHEDULE_CURSOR_STALE),
    ).toBe("revisionConflict");
  });

  it("leaves a stale client to the existing reload modal", () => {
    expect(
      taskScheduleSeriesFeedbackKey(
        CORE_API_ERROR_KINDS.CALENDAR_CLIENT_UPGRADE_REQUIRED,
      ),
    ).toBeNull();
  });

  it("keeps quarantine distinct from a plain revision conflict", () => {
    expect(
      taskScheduleSeriesFeedbackKey(CORE_API_ERROR_KINDS.SCHEDULE_QUARANTINED),
    ).not.toBe(
      taskScheduleSeriesFeedbackKey(
        CORE_API_ERROR_KINDS.SCHEDULE_REVISION_CONFLICT,
      ),
    );
  });
});

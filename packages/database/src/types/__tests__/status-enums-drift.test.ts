import { SokosumiJobStatus, TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { TaskStatus as PrismaTaskStatus } from "../../generated/prisma/enums.js";

/**
 * `@sokosumi/utils` hosts the client-safe single source of truth for these
 * statuses so the web bundle does not depend on `@sokosumi/database`. The
 * Prisma `TaskStatus` enum can only be edited via the schema, so guard against
 * silent drift between the two definitions here, where both are importable.
 */
describe("status enum drift guard", () => {
  it("utils TaskStatus matches the Prisma-generated TaskStatus enum", () => {
    expect({ ...TaskStatus }).toEqual({ ...PrismaTaskStatus });
  });

  it("SokosumiJobStatus keeps its canonical lowercase string values", () => {
    // SokosumiJobStatus has no Prisma counterpart; lock the values so the
    // client-safe map cannot drift unnoticed.
    expect({ ...SokosumiJobStatus }).toEqual({
      STARTED: "started",
      COMPLETED: "completed",
      PROCESSING: "processing",
      INPUT_REQUIRED: "input_required",
      RESULT_PENDING: "result_pending",
      FAILED: "failed",
      PAYMENT_PENDING: "payment_pending",
      PAYMENT_FAILED: "payment_failed",
      REFUND_PENDING: "refund_pending",
      REFUND_RESOLVED: "refund_resolved",
      DISPUTE_PENDING: "dispute_pending",
      DISPUTE_RESOLVED: "dispute_resolved",
    });
  });
});

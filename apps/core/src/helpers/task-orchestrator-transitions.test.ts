import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { validateStatusTransition } from "@/helpers/task";
import type { AuthenticationContext } from "@/middleware/auth";

const orchestratorAuth: AuthenticationContext = {
  actor: "orchestrator",
  orchestratorId: "01960001-0001-7001-8001-000000000099",
  context: {
    userId: "user_123",
    organizationId: null,
  },
};

describe("orchestrator task status transitions", () => {
  it("allows DRAFT to READY and READY to DRAFT", () => {
    expect(() =>
      validateStatusTransition(
        orchestratorAuth,
        TaskStatus.DRAFT,
        TaskStatus.READY,
      ),
    ).not.toThrow();

    expect(() =>
      validateStatusTransition(
        orchestratorAuth,
        TaskStatus.READY,
        TaskStatus.DRAFT,
      ),
    ).not.toThrow();
  });

  it("rejects other status transitions", () => {
    expect(() =>
      validateStatusTransition(
        orchestratorAuth,
        TaskStatus.READY,
        TaskStatus.CANCELED,
      ),
    ).toThrow(/Invalid status transition/);

    expect(() =>
      validateStatusTransition(
        orchestratorAuth,
        TaskStatus.RUNNING,
        TaskStatus.COMPLETED,
      ),
    ).toThrow(/Invalid status transition/);
  });
});

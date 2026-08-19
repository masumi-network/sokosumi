import { describe, expect, it } from "vitest";

import {
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_SCRATCH_CAPABILITIES,
} from "../policy.js";

describe("Soko Bot route capability ceilings", () => {
  it("keeps ambiguous routes read-only", () => {
    for (const route of ["CLARIFY", "MIXED"] as const) {
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain("create_task");
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain("hire_agent");
      expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain("update_memory");
    }
  });

  it("does not leak agent hiring into task delegation", () => {
    expect(SOKO_BOT_ROUTE_CAPABILITIES.DELEGATE_TASK).toContain("create_task");
    expect(SOKO_BOT_ROUTE_CAPABILITIES.DELEGATE_TASK).not.toContain(
      "hire_agent",
    );
    expect(SOKO_BOT_ROUTE_CAPABILITIES.HIRE_AGENT).toContain("hire_agent");
    expect(SOKO_BOT_ROUTE_CAPABILITIES.HIRE_AGENT).not.toContain("create_task");
  });

  it("keeps scratch capabilities outside product policy", () => {
    for (const capabilities of Object.values(SOKO_BOT_ROUTE_CAPABILITIES)) {
      for (const scratch of SOKO_BOT_SCRATCH_CAPABILITIES) {
        expect(capabilities).not.toContain(scratch);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { INVALID_RUN_PREFIX, invalidRunReason } from "./parity";

describe("a stored run that must not be compared or re-judged", () => {
  it("is one the outbound guard marked invalid, or one that never completed", () => {
    const label = `${INVALID_RUN_PREFIX} the outbound guard refused 2 call(s) to api.exa.ai`;
    expect(
      invalidRunReason({ run: { status: "CANCELLED", label }, cases: [] }),
    ).toBe(label);
    expect(
      invalidRunReason({ run: { status: "RUNNING", label: null }, cases: [] }),
    ).toBe("run status RUNNING");
    expect(
      invalidRunReason({
        run: { status: "COMPLETED", label: "plan" },
        cases: [],
      }),
    ).toBeNull();
  });
});

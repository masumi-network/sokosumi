import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import { toActionResult } from "@/lib/actions/action-result";

describe("toActionResult", () => {
  it("maps a successful neverthrow Result to { ok: true, value }", () => {
    const wire = toActionResult(ok({ id: "agent-1" }));

    expect(wire).toEqual({ ok: true, value: { id: "agent-1" } });
  });

  it("maps a failed neverthrow Result to { ok: false, error }", () => {
    const wire = toActionResult(err({ code: "BAD_INPUT", message: "invalid" }));

    expect(wire).toEqual({
      ok: false,
      error: { code: "BAD_INPUT", message: "invalid" },
    });
  });

  it("maps ok(undefined) without inventing a data field", () => {
    const wire = toActionResult(ok(undefined));

    expect(wire).toEqual({ ok: true, value: undefined });
    expect(wire).not.toHaveProperty("data");
  });
});

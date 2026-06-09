import { describe, expect, it } from "vitest";

import { HermesOrchestratorError } from "@/clients/hermes-orchestrator.client";
import { isTransientOrchestratorError } from "@/services/hermes-inbox-sync.service";

describe("isTransientOrchestratorError", () => {
  it("treats HermesOrchestratorError with 5xx status as transient", () => {
    expect(
      isTransientOrchestratorError(new HermesOrchestratorError(500, {})),
    ).toBe(true);
    expect(
      isTransientOrchestratorError(
        new HermesOrchestratorError(502, { code: "BAD_GATEWAY" }),
      ),
    ).toBe(true);
    expect(
      isTransientOrchestratorError(new HermesOrchestratorError(503, {})),
    ).toBe(true);
  });

  it("treats HermesOrchestratorError with 4xx status as non-transient", () => {
    expect(
      isTransientOrchestratorError(new HermesOrchestratorError(400, {})),
    ).toBe(false);
    expect(
      isTransientOrchestratorError(new HermesOrchestratorError(404, {})),
    ).toBe(false);
    expect(
      isTransientOrchestratorError(new HermesOrchestratorError(429, {})),
    ).toBe(false);
  });

  it("treats TypeError('fetch failed') with a cause as transient (connect timeout, reset, etc.)", () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: new Error("connect timeout"),
    });
    expect(isTransientOrchestratorError(err)).toBe(true);
  });

  it("does not treat TypeError('fetch failed') without a cause as transient", () => {
    expect(isTransientOrchestratorError(new TypeError("fetch failed"))).toBe(
      false,
    );
  });

  it("does not treat unrelated TypeErrors as transient", () => {
    expect(
      isTransientOrchestratorError(
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBe(false);
  });

  it("does not treat generic Errors as transient", () => {
    expect(
      isTransientOrchestratorError(new Error("some unexpected error")),
    ).toBe(false);
  });

  it("does not treat non-Error values as transient", () => {
    expect(isTransientOrchestratorError(null)).toBe(false);
    expect(isTransientOrchestratorError("string error")).toBe(false);
    expect(isTransientOrchestratorError(42)).toBe(false);
  });
});

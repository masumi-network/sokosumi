import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await vi.importActual<
    typeof import("@/lib/clients/core.request")
  >("@/lib/clients/core.request");
  return { CoreApiRequestError };
});

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { toMarketLoadError } from "./ads-market";

describe("toMarketLoadError", () => {
  it("reads a provider that is not set up by its kind, not its status", () => {
    expect(
      toMarketLoadError(
        new CoreApiRequestError("x", {
          status: 503,
          kind: "integration_not_configured",
        }),
      ),
    ).toBe("unavailable");
  });

  it.each([502, 503, 404])(
    "calls a %s without that kind a failure",
    (status) => {
      expect(toMarketLoadError(new CoreApiRequestError("x", { status }))).toBe(
        "failed",
      );
    },
  );

  it("lets anything that is not a Core failure through", () => {
    expect(() => toMarketLoadError(new Error("session lost"))).toThrow(
      "session lost",
    );
  });
});

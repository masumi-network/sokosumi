import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await vi.importActual<
    typeof import("@/lib/clients/core.request")
  >("@/lib/clients/core.request");
  return { CoreApiRequestError };
});

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { settleAdsLoad, toAdsLoadError } from "./ads-load-error";

describe("toAdsLoadError", () => {
  it("reads a provider that is not set up by its kind, not its status", () => {
    expect(
      toAdsLoadError(
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
      expect(toAdsLoadError(new CoreApiRequestError("x", { status }))).toBe(
        "failed",
      );
    },
  );

  it("lets anything that is not a Core failure through", () => {
    expect(() => toAdsLoadError(new Error("session lost"))).toThrow(
      "session lost",
    );
  });
});

describe("settleAdsLoad", () => {
  it("hands back the data", async () => {
    await expect(settleAdsLoad(Promise.resolve([1]))).resolves.toEqual({
      data: [1],
    });
  });

  it("hands back the error to show for a Core failure", async () => {
    await expect(
      settleAdsLoad(
        Promise.reject(new CoreApiRequestError("x", { status: 502 })),
      ),
    ).resolves.toEqual({ error: "failed" });
  });

  it("rejects for anything else", async () => {
    await expect(
      settleAdsLoad(Promise.reject(new Error("session lost"))),
    ).rejects.toThrow("session lost");
  });
});

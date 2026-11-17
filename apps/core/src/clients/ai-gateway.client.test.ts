import { afterEach, describe, expect, it, vi } from "vitest";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

vi.mock("@/lib/ai-gateway-purpose", () => ({
  aiGatewayApiKey: () => "gateway-test-key",
}));

describe("listGatewayModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the gateway's answer out of the log when the list cannot be read", async () => {
    const errors = expectCoreLogWhys(
      "warn",
      "The AI Gateway model list could not be loaded",
      ["The model list request failed before an answer could be read"],
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("<html>Ada private proxy page</html>")),
    );
    const { listGatewayModels } = await import("./ai-gateway.client");

    await expect(listGatewayModels()).resolves.toEqual([]);

    expect(errors[0]?.cause).toBeUndefined();
    expect(errors[0]?.event).toMatchObject({
      provider: "ai-gateway",
      failure: { errorName: "SyntaxError" },
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("Ada private");
  });

  it("logs the status when the gateway answers with an error", async () => {
    const errors = expectCoreLogWhys(
      "warn",
      "The AI Gateway did not return its model list",
      ["The AI Gateway answered the model list request with an error status"],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 503 })),
    );
    const { listGatewayModels } = await import("./ai-gateway.client");

    await expect(listGatewayModels()).resolves.toEqual([]);

    expect(errors[0]?.event).toMatchObject({ status: 503 });
  });
});

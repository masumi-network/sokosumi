import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { finalizeMeasurement } = vi.hoisted(() => ({
  finalizeMeasurement: vi.fn(),
}));
vi.mock("../../cmo-actions", () => ({ finalizeMeasurement }));

import { GET } from "./route";

const callback = (query: string) =>
  GET(new NextRequest(`http://localhost:3110/measure/callback?${query}`));

describe("measure callback", () => {
  beforeEach(() => finalizeMeasurement.mockReset());

  it("finishes the connection and resumes onboarding on Results", async () => {
    finalizeMeasurement.mockResolvedValue(true);
    const response = await callback(
      "provider=shopify&from=onboarding&project=project-2&status=success",
    );
    expect(finalizeMeasurement).toHaveBeenCalledWith(
      "project-2",
      "shopify",
      null,
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/?step=results&from=onboarding",
    );
  });

  it("hands Composio's session on, so Cuso's bot redeems it", async () => {
    finalizeMeasurement.mockResolvedValue(true);
    await callback(
      "provider=shopify&from=onboarding&project=project-2&session_uri=one-use",
    );
    expect(finalizeMeasurement).toHaveBeenCalledWith(
      "project-2",
      "shopify",
      "one-use",
    );
  });

  it("returns to the Results page in the app", async () => {
    finalizeMeasurement.mockResolvedValue(true);
    const response = await callback(
      "provider=google_analytics&from=app&project=project-2",
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3110/results",
    );
  });

  it("says it failed for a refusal or an unknown source", async () => {
    const refused = await callback(
      "provider=shopify&project=project-2&status=failed",
    );
    const unknown = await callback("provider=gmail&project=project-2");
    expect(finalizeMeasurement).not.toHaveBeenCalled();
    expect(refused.headers.get("location")).toContain("measure=failed");
    expect(unknown.headers.get("location")).toContain("measure=failed");
  });

  it("finishes nothing without the Project it started from", async () => {
    const response = await callback("provider=shopify&from=app");
    expect(finalizeMeasurement).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("measure=failed");
  });
});

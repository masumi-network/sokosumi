import { describe, expect, it } from "vitest";

import {
  buildOrchestratorImagePathname,
  buildOrchestratorImagePrefix,
  isOrchestratorImageAllowedContentType,
  isOwnedOrchestratorImageUrl,
  ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES,
} from "../orchestrator-image-upload.js";

describe("isOrchestratorImageAllowedContentType", () => {
  it("accepts listed image types (case-insensitive)", () => {
    expect(isOrchestratorImageAllowedContentType("image/png")).toBe(true);
    expect(isOrchestratorImageAllowedContentType("IMAGE/JPEG")).toBe(true);
    expect(isOrchestratorImageAllowedContentType(" image/webp ")).toBe(true);
    expect(isOrchestratorImageAllowedContentType("image/gif")).toBe(true);
  });

  it("rejects non-image, svg, and unlisted types", () => {
    expect(isOrchestratorImageAllowedContentType("application/pdf")).toBe(
      false,
    );
    expect(isOrchestratorImageAllowedContentType("image/svg+xml")).toBe(false);
    expect(isOrchestratorImageAllowedContentType("text/plain")).toBe(false);
  });
});

describe("ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES", () => {
  it("is 2 MiB", () => {
    expect(ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe("buildOrchestratorImagePathname", () => {
  it("builds a sanitized pathname under the orchestrator prefix", () => {
    expect(
      buildOrchestratorImagePathname(
        "01960001-0001-7001-8001-000000000099",
        " Hermes Logo (1).png ",
      ),
    ).toBe(
      "orchestrators/01960001-0001-7001-8001-000000000099/image-Hermes_Logo_1.png",
    );
  });

  it("falls back when the filename is empty after sanitizing", () => {
    expect(
      buildOrchestratorImagePathname(
        "01960001-0001-7001-8001-000000000099",
        "@@@",
      ),
    ).toBe("orchestrators/01960001-0001-7001-8001-000000000099/image-file");
  });
});

describe("isOwnedOrchestratorImageUrl", () => {
  const orchestratorId = "01960001-0001-7001-8001-000000000099";
  const prefix = buildOrchestratorImagePrefix(orchestratorId);

  it("accepts blob URLs under the orchestrator prefix", () => {
    expect(
      isOwnedOrchestratorImageUrl(
        `https://abc.public.blob.vercel-storage.com/${prefix}image-hermes-Ab12.png`,
        orchestratorId,
      ),
    ).toBe(true);
  });

  it("rejects other orchestrators and foreign hosts with wrong path", () => {
    expect(
      isOwnedOrchestratorImageUrl(
        `https://abc.public.blob.vercel-storage.com/orchestrators/other-id/image.png`,
        orchestratorId,
      ),
    ).toBe(false);
    expect(
      isOwnedOrchestratorImageUrl(
        "https://example.com/evil.png",
        orchestratorId,
      ),
    ).toBe(false);
    expect(isOwnedOrchestratorImageUrl("not-a-url", orchestratorId)).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  buildOrchestratorImagePathname,
  buildOrchestratorImagePrefix,
  extensionForOrchestratorImageMime,
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

describe("extensionForOrchestratorImageMime", () => {
  it("maps allowed MIME types to file extensions", () => {
    expect(extensionForOrchestratorImageMime("image/png")).toBe("png");
    expect(extensionForOrchestratorImageMime("IMAGE/JPEG")).toBe("jpg");
    expect(extensionForOrchestratorImageMime("image/webp")).toBe("webp");
    expect(extensionForOrchestratorImageMime("image/gif")).toBe("gif");
    expect(extensionForOrchestratorImageMime("image/svg+xml")).toBeNull();
  });
});

describe("buildOrchestratorImagePathname", () => {
  it("builds a sanitized pathname under the orchestrator prefix", () => {
    expect(
      buildOrchestratorImagePathname(
        "01960001-0001-7001-8001-000000000099",
        " Hermes Logo (1).png ",
        "image/png",
      ),
    ).toBe(
      "orchestrators/01960001-0001-7001-8001-000000000099/image-Hermes_Logo_1.png",
    );
  });

  it("uses the content-type extension when the filename extension differs", () => {
    expect(
      buildOrchestratorImagePathname(
        "01960001-0001-7001-8001-000000000099",
        "logo.jpg",
        "image/png",
      ),
    ).toBe("orchestrators/01960001-0001-7001-8001-000000000099/image-logo.png");
  });

  it("falls back when the filename is empty after sanitizing", () => {
    expect(
      buildOrchestratorImagePathname(
        "01960001-0001-7001-8001-000000000099",
        "@@@",
        "image/webp",
      ),
    ).toBe(
      "orchestrators/01960001-0001-7001-8001-000000000099/image-file.webp",
    );
  });
});

describe("isOwnedOrchestratorImageUrl", () => {
  const orchestratorId = "01960001-0001-7001-8001-000000000099";
  const prefix = buildOrchestratorImagePrefix(orchestratorId);

  it("accepts public Vercel Blob URLs under the orchestrator prefix", () => {
    expect(
      isOwnedOrchestratorImageUrl(
        `https://abc.public.blob.vercel-storage.com/${prefix}image-hermes-Ab12.png`,
        orchestratorId,
      ),
    ).toBe(true);
  });

  it("rejects other orchestrators, non-blob hosts, http, and invalid URLs", () => {
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
    // Path matches ownership prefix but host is not Vercel Blob public storage.
    expect(
      isOwnedOrchestratorImageUrl(
        `https://evil.example.com/${prefix}image.png`,
        orchestratorId,
      ),
    ).toBe(false);
    // Host/path match but scheme is not HTTPS.
    expect(
      isOwnedOrchestratorImageUrl(
        `http://abc.public.blob.vercel-storage.com/${prefix}image-hermes-Ab12.png`,
        orchestratorId,
      ),
    ).toBe(false);
    expect(isOwnedOrchestratorImageUrl("not-a-url", orchestratorId)).toBe(
      false,
    );
  });
});

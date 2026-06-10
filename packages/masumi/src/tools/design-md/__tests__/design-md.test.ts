import { describe, expect, it, vi } from "vitest";

import { createDesignMdClient } from "../client.js";
import { buildDesignMdPreviewUrl } from "../preview-url.js";
import { designMdApiResponseSchema } from "../schemas.js";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

describe("buildDesignMdPreviewUrl", () => {
  it("builds a cached Masumi DESIGN.md preview URL", () => {
    expect(buildDesignMdPreviewUrl("https://www.masumi.network", 42)).toBe(
      "https://www.masumi.network/tools/design-md?cached=42",
    );
  });

  it("adds www to the preview host", () => {
    expect(buildDesignMdPreviewUrl("https://masumi.network", 42)).toBe(
      "https://www.masumi.network/tools/design-md?cached=42",
    );
  });

  it("keeps local preview hosts unchanged", () => {
    expect(buildDesignMdPreviewUrl("http://localhost:3000", 42)).toBe(
      "http://localhost:3000/tools/design-md?cached=42",
    );
  });
});

describe("designMdApiResponseSchema", () => {
  it("parses direct and wrapped payloads", () => {
    const direct = designMdApiResponseSchema.parse({
      status: "done",
      extractionId: 42,
      designMd: "# Brand",
      cached: true,
      source: "cache",
    });

    const wrapped = designMdApiResponseSchema.parse({
      data: {
        status: "queued",
        jobId: "job_1",
      },
    });

    expect(direct.status).toBe("done");
    expect(wrapped).toEqual({ status: "queued", jobId: "job_1" });
  });

  it("parses running job payloads", () => {
    const running = designMdApiResponseSchema.parse({
      status: "running",
      jobId: "job_1",
      url: "https://example.com",
      createdAt: 1_781_011_305_765,
      startedAt: 1_781_011_305_765,
    });

    expect(running).toEqual({ status: "running", jobId: "job_1" });
  });
});

describe("createDesignMdClient", () => {
  it("submits URL generation requests with bearer auth", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "queued",
        jobId: "job_1",
      }),
    );
    const client = createDesignMdClient({
      apiUrl: "https://masumi.example.com/api/v1",
      apiKey: "internal-key",
      fetch: fetchMock,
    });

    const result = await client.submit({
      url: "https://example.com",
      force: true,
    });

    expect(result.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://masumi.example.com/api/v1/design-md",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer internal-key",
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          url: "https://example.com",
          force: true,
        }),
      }),
    );
  });

  it("polls a queued job until done", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "queued",
          jobId: "job_1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "running",
          jobId: "job_1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          extractionId: 42,
          designMd: "# Brand",
          cached: false,
        }),
      );
    const client = createDesignMdClient({
      apiUrl: "https://masumi.example.com/api/v1/",
      apiKey: "internal-key",
      fetch: fetchMock,
    });

    const result = await client.generateUntilDone({
      url: "https://example.com",
      pollIntervalMs: 0,
    });

    expect(result.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://masumi.example.com/api/v1/design-md/jobs/job_1",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("returns schema validation errors for unexpected payloads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: "done",
        extractionId: 42,
      }),
    );
    const client = createDesignMdClient({
      apiKey: "internal-key",
      fetch: fetchMock,
    });

    const result = await client.submit({
      url: "https://example.com",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("schema_validation_error");
  });

  it("returns HTTP errors for non-2xx responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          message: "nope",
        },
        { status: 500 },
      ),
    );
    const client = createDesignMdClient({
      apiKey: "internal-key",
      fetch: fetchMock,
    });

    const result = await client.submit({
      url: "https://example.com",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      type: "http_error",
      status: 500,
      message: "Masumi DESIGN.md API responded with 500",
    });
  });
});

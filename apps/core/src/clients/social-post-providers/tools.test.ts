import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
  executeComposioTool,
  guardSocialCreateOutcome,
  stageSocialPublishFile,
} from "./tools";

const { getEnvMock, logSetMock, ssrfSafeFetchMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ set: logSetMock }) }));
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  getEnvMock.mockReturnValue({ COMPOSIO_API_KEY: "test-composio-key" });
});

describe("stageSocialPublishFile", () => {
  it.each([
    ["twitter", "TWITTER_UPLOAD_MEDIA", "launch.jpg", "image/jpeg"],
    ["twitter", "TWITTER_UPLOAD_LARGE_MEDIA", "launch.png", "image/png"],
    ["youtube", "YOUTUBE_UPLOAD_VIDEO", "launch.mp4", "video/mp4"],
  ])(
    "stages %s/%s with the exact filename, content type and bytes",
    async (toolkitSlug, toolSlug, name, mimeType) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          key: "staged-key",
          new_presigned_url: "https://uploads.example.com/staged-key",
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      ssrfSafeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      const bytes = new Uint8Array([0, 1, 2, 255]);

      await expect(
        stageSocialPublishFile({
          toolkitSlug,
          toolSlug,
          file: {
            bytes,
            name,
            mimeType,
            kind: mimeType.startsWith("video/") ? "video" : "image",
          },
        }),
      ).resolves.toBe("staged-key");

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url.pathname).toBe("/api/v3.1/files/upload/request");
      expect(JSON.parse(init.body)).toEqual({
        toolkit_slug: toolkitSlug,
        tool_slug: toolSlug,
        filename: name,
        mimetype: mimeType,
        md5: "0416dab819887333af831f8c765ac2ae",
      });
      expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
        "https://uploads.example.com/staged-key",
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: bytes,
        }),
      );
    },
  );

  it("uses the same attachment fallback as the X media name for an empty filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        key: "staged-key",
        new_presigned_url: "https://uploads.example.com/staged-key",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    ssrfSafeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await stageSocialPublishFile({
      toolkitSlug: "twitter",
      toolSlug: "TWITTER_UPLOAD_MEDIA",
      file: {
        bytes: new Uint8Array([1]),
        name: "",
        mimeType: "image/jpeg",
        kind: "image",
      },
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).filename).toBe(
      "attachment",
    );
  });

  it("does not expose the staging response when the bytes cannot be uploaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          key: "staged-key",
          new_presigned_url: "https://uploads.example.com/staged-key",
        }),
      ),
    );
    ssrfSafeFetchMock.mockResolvedValue(
      new Response("private-storage-error", { status: 403 }),
    );

    await expect(
      stageSocialPublishFile({
        toolkitSlug: "twitter",
        toolSlug: "TWITTER_UPLOAD_MEDIA",
        file: {
          bytes: new Uint8Array([1]),
          name: "launch.jpg",
          mimeType: "image/jpeg",
          kind: "image",
        },
      }),
    ).rejects.toMatchObject({
      message: "Could not stage media",
      httpStatus: 403,
      body: undefined,
    });
  });
});

describe("executeComposioTool", () => {
  it.each(["TWITTER_UPLOAD_MEDIA", "TWITTER_UPLOAD_LARGE_MEDIA"])(
    "preserves a nested X problem's safe diagnosis and status for %s",
    async (toolSlug) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            data: {
              successful: false,
              error: {
                response: {
                  status: 400,
                  title: "Invalid Request",
                  type: "https://api.x.com/2/problems/invalid-request",
                  detail: "One or more parameters to your request was invalid.",
                  errors: [{ message: "private-provider-message" }],
                  request: { token: "private-request-token" },
                },
              },
            },
          }),
        ),
      );

      const failure = await executeComposioTool({
        sessionId: "sess_fixture",
        toolSlug,
        arguments: {},
        context: "upload X image",
        refused: "X could not upload the image",
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ComposioToolError);
      expect(failure).toMatchObject({
        providerStatus: 400,
        message:
          "X could not upload the image (400, invalid-request): The image upload request has invalid parameters. Try again or use a different image.",
        providerMessage:
          "The image upload request has invalid parameters. Try again or use a different image.",
      });
      expect(JSON.stringify(failure)).not.toContain("private-");
      expect(JSON.stringify(logSetMock.mock.calls)).not.toContain("private-");
      expect(logSetMock).toHaveBeenCalledWith({
        composio: expect.objectContaining({
          operation: "upload X image",
          failure: "tool_error",
        }),
      });
    },
  );

  it.each([
    [401, "Unauthorized"],
    [429, "Too Many Requests"],
  ])(
    "preserves status %s inside an unsuccessful tool envelope",
    async (status, title) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            successful: false,
            error: { data: { status, title } },
          }),
        ),
      );

      await expect(
        executeComposioTool({
          sessionId: "sess_fixture",
          toolSlug: "TWITTER_UPLOAD_MEDIA",
          arguments: {},
          context: "upload X image",
          refused: "X could not upload the image",
        }),
      ).rejects.toMatchObject({ providerStatus: status });
    },
  );
});

describe("ComposioToolError", () => {
  it("redacts tokens, urls, and session ids from the stored provider message", () => {
    const error = new ComposioToolError({
      message: "X rejected the post",
      providerMessage:
        "Bearer supersecret https://graph.facebook.com/v19.0/me sess_abc123def token=leakvalue",
      providerStatus: 403,
    });
    expect(error.providerStatus).toBe(403);
    expect(error.providerMessage).toContain("Bearer [redacted]");
    expect(error.providerMessage).toContain("[redacted-url]");
    expect(error.providerMessage).not.toContain("supersecret");
    expect(error.providerMessage).not.toContain("graph.facebook.com");
    expect(error.providerMessage).not.toContain("sess_abc123def");
  });
});

describe("guardSocialCreateOutcome", () => {
  it("keeps a refused 4xx so the post can be edited", async () => {
    const refused = new ComposioApiError(400, undefined, "text too long");
    await expect(
      guardSocialCreateOutcome("X", async () => {
        throw refused;
      }),
    ).rejects.toBe(refused);
  });

  it("keeps a rate limit so the scheduler can retry", async () => {
    const limited = new ComposioToolError({
      message: "X rejected the post",
      providerStatus: 429,
      providerMessage: "rate limited",
    });
    await expect(
      guardSocialCreateOutcome("X", async () => {
        throw limited;
      }),
    ).rejects.toBe(limited);
  });

  it("treats a timeout as unknown so a retry does not double-post", async () => {
    await expect(
      guardSocialCreateOutcome("X", async () => {
        throw new ComposioToolError({
          message: "X rejected the post",
          providerMessage: "request timed out",
        });
      }),
    ).rejects.toBeInstanceOf(ComposioPublishOutcomeUnknownError);
  });

  it("treats a 500 as unknown so a retry does not double-post", async () => {
    await expect(
      guardSocialCreateOutcome("YouTube", async () => {
        throw new ComposioApiError(500, undefined, "upstream");
      }),
    ).rejects.toMatchObject({
      name: "ComposioPublishOutcomeUnknownError",
      message: expect.stringContaining("YouTube"),
    });
  });
});

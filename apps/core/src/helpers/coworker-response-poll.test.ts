import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollCoworkerResponseStatus } from "./coworker-response-poll";

const fetchMock = vi.fn();

const DEFAULT_PARAMS = {
  responsesApiBaseUrl: "https://api.coworker.example.com/v1",
  responseId: "resp_pending",
  userId: "user_1",
  organizationId: "org_1",
  coworkerSlug: "elena",
  fetchFn: fetchMock,
  maxAttempts: 3,
  baseDelayMs: 10,
  maxDelayMs: 40,
};

function jsonResponse(status: string, httpStatus = 200): Response {
  return new Response(JSON.stringify({ id: "resp_pending", status }), {
    status: httpStatus,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pollCoworkerResponseStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retrieves with coworker headers", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("completed"));

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result).toEqual({
      status: "completed",
      responseId: "resp_pending",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/responses/resp_pending",
      expect.objectContaining({
        method: "GET",
        headers: {
          "X-Sokosumi-User-Id": "user_1",
          "X-Coworker-Slug": "elena",
          "X-Sokosumi-Organization-Id": "org_1",
        },
      }),
    );
  });

  it("polls in_progress until a terminal status", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse("in_progress"))
      .mockResolvedValueOnce(jsonResponse("completed"));

    const resultPromise = pollCoworkerResponseStatus(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns failed when coworker reports failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("failed"));

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result).toEqual({
      status: "failed",
      responseId: "resp_pending",
    });
  });

  it("returns error on HTTP failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse("completed", 503));

    const result = await pollCoworkerResponseStatus(DEFAULT_PARAMS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.responseId).toBe("resp_pending");
      expect(result.cause).toBeInstanceOf(Error);
    }
  });

  it("returns in_progress when max attempts are exhausted", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => jsonResponse("in_progress"));

    const resultPromise = pollCoworkerResponseStatus(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({
      status: "in_progress",
      responseId: "resp_pending",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

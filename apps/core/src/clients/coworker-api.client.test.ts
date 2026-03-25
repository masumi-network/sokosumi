import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  coworkerConversationClient,
  createCoworkerConversationClient,
  extractTextFromCompletedOutput,
  getResponseById,
} from "@/clients/coworker-api.client";

const fetchMock = vi.fn();
const textEncoder = new TextEncoder();

const DEFAULT_BASE_URL = "https://api.coworker.example.com/v1";

function createSseStream(lines: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(textEncoder.encode(lines.join("\n")));
      controller.close();
    },
  });
}

describe("coworker-api.client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("extractTextFromCompletedOutput", () => {
    it("returns empty string for non-array or empty output", () => {
      expect(extractTextFromCompletedOutput(null)).toBe("");
      expect(extractTextFromCompletedOutput(undefined)).toBe("");
      expect(extractTextFromCompletedOutput([])).toBe("");
      expect(extractTextFromCompletedOutput({})).toBe("");
    });

    it("extracts text from output_text content parts", () => {
      const output = [
        {
          type: "message",
          content: [
            { type: "output_text", text: "Hello " },
            { type: "output_text", text: "world" },
          ],
        },
      ];
      expect(extractTextFromCompletedOutput(output)).toBe("Hello world");
    });

    it("ignores non-message or non-output_text items", () => {
      const output = [
        { type: "other" },
        {
          type: "message",
          content: [{ type: "input_text", text: "ignored" }],
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "kept" }],
        },
      ];
      expect(extractTextFromCompletedOutput(output)).toBe("kept");
    });
  });

  describe("getResponseById", () => {
    it("returns in_progress for 202 response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 202,
      });

      const result = await getResponseById("resp_123", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
      });

      expect(result).toEqual({ status: "in_progress" });
    });

    it("returns not_found for 404 response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await getResponseById("resp_123", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
      });

      expect(result).toEqual({ status: "not_found" });
    });

    it("returns terminal for 200 with failed status", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp_123",
          status: "failed",
          error: { message: "model error" },
        }),
      });

      const result = await getResponseById("resp_123", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
      });

      expect(result).toEqual({
        status: "terminal",
        apiStatus: "failed",
      });
    });

    it("returns terminal for 200 with completed but no output", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp_123",
          status: "completed",
        }),
      });

      const result = await getResponseById("resp_123", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
      });

      expect(result).toEqual({
        status: "terminal",
        apiStatus: "completed",
      });
    });

    it("returns completed for incomplete status when output is present", async () => {
      const output = [
        {
          type: "message",
          content: [{ type: "output_text", text: "Partial" }],
        },
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp_123",
          status: "incomplete",
          output,
        }),
      });

      const result = await getResponseById("resp_123", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
      });

      expect(result).toEqual({
        status: "completed",
        id: "resp_123",
        output,
      });
    });

    it("returns completed with id and output for 200 with status completed", async () => {
      const output = [
        {
          type: "message",
          content: [{ type: "output_text", text: "Assistant reply" }],
        },
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp_123",
          status: "completed",
          output,
        }),
      });

      const result = await getResponseById("resp_123", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: "org_1",
        coworkerSlug: "ops-agent",
      });

      expect(result).toEqual({
        status: "completed",
        id: "resp_123",
        output,
      });
    });

    it("throws when responsesApiBaseUrl is missing", async () => {
      fetchMock.mockClear();
      await expect(
        getResponseById("resp_123", {
          responsesApiBaseUrl: "",
          sokosumiUserId: "user_1",
          sokosumiOrganizationId: null,
          coworkerSlug: "ops-agent",
        }),
      ).rejects.toThrow("Responses API base URL is required");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws on non-200/202/404 error response", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(
        getResponseById("resp_123", {
          responsesApiBaseUrl: DEFAULT_BASE_URL,
          sokosumiUserId: "user_1",
          sokosumiOrganizationId: null,
          coworkerSlug: "ops-agent",
        }),
      ).rejects.toThrow("Responses API GET error");
    });

    it("returns in_progress when fetch times out or aborts", async () => {
      const timeoutErr = new Error("The operation was aborted due to timeout");
      timeoutErr.name = "TimeoutError";
      fetchMock.mockRejectedValueOnce(timeoutErr);

      const result = await getResponseById("resp_123", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
      });

      expect(result).toEqual({ status: "in_progress" });
    });

    it("calls GET with correct URL and headers", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "in_progress" }),
      });

      await getResponseById("resp_abc", {
        responsesApiBaseUrl: DEFAULT_BASE_URL,
        responsesApiServiceKey: "sk_test_123",
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: "org_1",
        coworkerSlug: "my-slug",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.coworker.example.com/v1/responses/resp_abc",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer sk_test_123",
            "X-Sokosumi-User-Id": "user_1",
            "X-Coworker-Slug": "my-slug",
            "X-Sokosumi-Organization-Id": "org_1",
          }),
        }),
      );
    });
  });

  describe("coworkerConversationClient", () => {
    it("uses coworker provider identifier", () => {
      expect(coworkerConversationClient.provider).toBe("coworker");
    });

    it("streams coworker response and propagates lifecycle callbacks", async () => {
      const onResponseStarted = vi.fn();
      const onResponseCompleted = vi.fn();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createSseStream([
          "event: response.created",
          'data: {"type":"response.created","response":{"id":"resp_start"}}',
          "event: response.output_text.delta",
          'data: {"type":"response.output_text.delta","delta":"Hi"}',
          "event: response.completed",
          'data: {"type":"response.completed","response":{"id":"resp_done"}}',
          "data: [DONE]",
          "",
        ]),
      });

      const response = await coworkerConversationClient.stream({
        actor: {
          userId: "user_1",
          organizationId: "org_1",
        },
        coworker: {
          id: "coworker_1",
          slug: "ops-agent",
          baseUrl: DEFAULT_BASE_URL,
        },
        lifecycle: {
          onResponseStarted,
          onResponseCompleted,
        },
        messages: [
          { role: "assistant", content: "Previous response" },
          { role: "user", content: "Latest question" },
        ],
        modelId: null,
        previousResponseId: "resp_prev",
      });

      await response.text();

      expect(onResponseStarted).toHaveBeenCalledWith("resp_start");
      expect(onResponseCompleted).toHaveBeenCalledWith("resp_done");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to full message input when previous response id is stale", async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => "invalid_previous_response_id",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: createSseStream(["data: [DONE]", ""]),
        });

      await coworkerConversationClient.stream({
        actor: {
          userId: "user_1",
          organizationId: null,
        },
        coworker: {
          id: "coworker_1",
          slug: "ops-agent",
          baseUrl: DEFAULT_BASE_URL,
        },
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "Second" },
          { role: "user", content: "Third" },
        ],
        modelId: null,
        previousResponseId: "resp_stale",
      });

      const firstCallBody = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      );
      const secondCallBody = JSON.parse(
        fetchMock.mock.calls[1][1].body as string,
      );

      expect(firstCallBody.input).toBe("Third");
      expect(firstCallBody.previous_response_id).toBe("resp_stale");
      expect(secondCallBody.input).toEqual([
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
        { role: "user", content: "Third" },
      ]);
      expect(secondCallBody.previous_response_id).toBeUndefined();
    });

    it("supports pending response recovery through the adapter contract", async () => {
      const client = createCoworkerConversationClient({
        responsesApiServiceKey: "service_key_123",
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp_123",
          status: "completed",
          output: [],
        }),
      });

      const result = await client.recoverPendingResponse?.({
        actor: {
          userId: "user_1",
          organizationId: "org_1",
        },
        pendingResponseId: "resp_123",
        coworker: {
          id: "coworker_1",
          slug: "ops-agent",
          baseUrl: DEFAULT_BASE_URL,
        },
      });

      expect(result).toEqual({
        status: "completed",
        id: "resp_123",
        output: [],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${DEFAULT_BASE_URL}/responses/resp_123`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer service_key_123",
            "X-Coworker-Slug": "ops-agent",
            "X-Sokosumi-Organization-Id": "org_1",
            "X-Sokosumi-User-Id": "user_1",
          }),
          method: "GET",
        }),
      );
    });
  });
});

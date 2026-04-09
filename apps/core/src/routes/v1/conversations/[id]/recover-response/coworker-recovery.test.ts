import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  extractTextFromCompletedOutput,
  getResponseById,
} from "./coworker-recovery";

const fetchMock = vi.fn();

const DEFAULT_BASE_URL = "https://api.coworker.example.com/v1";

describe("coworker-recovery", () => {
  beforeEach(() => {
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
});

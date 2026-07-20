import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hermesInstanceSchema,
  hermesScheduleSchema,
  hermesSchedulesListResponseSchema,
} from "@/schemas/hermes.schema";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

describe("hermes-orchestrator.client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("coerces invalid integration connectedAt to null so instance schema parse succeeds", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        status: "ready",
        endpointUrl: null,
        integrations: [
          {
            provider: "gmail",
            status: "connected",
            connectedAt: "not-a-valid-iso-datetime",
            mode: "read",
          },
        ],
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");
    const instance = await getInstance("user_123");

    expect(instance).not.toBeNull();
    expect(instance?.integrations).toEqual([
      {
        provider: "gmail",
        status: "connected",
        connectedAt: null,
        mode: "read",
      },
    ]);

    expect(() => hermesInstanceSchema.parse(instance)).not.toThrow();
  });

  it("preserves valid integration connectedAt", async () => {
    const connectedAt = "2024-06-01T12:00:00.000Z";
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        status: "ready",
        endpointUrl: null,
        integrations: [
          {
            provider: "gmail",
            status: "connected",
            connectedAt,
            mode: "write",
          },
        ],
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");
    const instance = await getInstance("user_456");

    expect(instance?.integrations[0]?.connectedAt).toBe(connectedAt);
    expect(() => hermesInstanceSchema.parse(instance)).not.toThrow();
  });

  it("coerces invalid onboardedAt to null so instance schema parse succeeds", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        status: "ready",
        endpointUrl: null,
        onboardedAt: "not-a-valid-iso-datetime",
        welcomeMessage: "Welcome back.",
        welcomeKind: "returning",
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");
    const instance = await getInstance("user_789");

    expect(instance?.onboardedAt).toBeNull();
    expect(instance?.welcomeMessage).toBe("Welcome back.");
    expect(() => hermesInstanceSchema.parse(instance)).not.toThrow();
  });

  it("coerces empty pending confirmation organization fields to null so instance schema parse succeeds", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        status: "ready",
        endpointUrl: null,
        pendingConfirmations: [
          {
            id: "conf_1",
            toolName: "sokosumi_create_task",
            summary: "Create task in workspace",
            createdAt: "2024-06-01T12:00:00.000Z",
            organizationId: "",
            organizationName: "",
          },
        ],
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");
    const instance = await getInstance("user_empty_org");

    expect(instance?.pendingConfirmations).toEqual([
      expect.objectContaining({
        id: "conf_1",
        organizationId: null,
        organizationName: null,
      }),
    ]);
    expect(() => hermesInstanceSchema.parse(instance)).not.toThrow();
  });

  it("coerces invalid schedule lastRunAt and nextRunAt to null so schedule schema parse succeeds", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        schedules: [
          {
            id: "sched_1",
            source: "hermes",
            kind: "user",
            name: "daily-brief",
            cron_expr: "0 9 * * *",
            enabled: true,
            last_run_at: "not-a-valid-iso-datetime",
            next_run_at: "also-invalid",
          },
        ],
      }),
    });

    const { listInstanceSchedules } = await import(
      "./hermes-orchestrator.client"
    );
    const schedules = await listInstanceSchedules("user_sched");

    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.lastRunAt).toBeNull();
    expect(schedules[0]?.nextRunAt).toBeNull();
    expect(() =>
      hermesSchedulesListResponseSchema.parse({ schedules }),
    ).not.toThrow();
    expect(() => hermesScheduleSchema.parse(schedules[0])).not.toThrow();
  });

  it("preserves valid schedule lastRunAt and nextRunAt", async () => {
    const lastRunAt = "2024-06-01T08:00:00.000Z";
    const nextRunAt = "2024-06-02T08:00:00.000Z";
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        schedules: [
          {
            id: "sched_2",
            source: "orchestrator",
            kind: "system_sweep",
            name: "sokosumi-sync",
            cronExpr: "0 */6 * * *",
            enabled: true,
            lastRunAt,
            nextRunAt,
          },
        ],
      }),
    });

    const { listInstanceSchedules } = await import(
      "./hermes-orchestrator.client"
    );
    const schedules = await listInstanceSchedules("user_sched_2");

    expect(schedules[0]?.lastRunAt).toBe(lastRunAt);
    expect(schedules[0]?.nextRunAt).toBe(nextRunAt);
    expect(() => hermesScheduleSchema.parse(schedules[0])).not.toThrow();
  });

  it("returns null only for a structured instance_not_found 404", async () => {
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({
        status: 404,
        code: "instance_not_found",
        title: "No Hermes instance exists for this user",
      }),
    });

    const { getInstance } = await import("./hermes-orchestrator.client");

    await expect(getInstance("user_gone")).resolves.toBeNull();
  });

  it("throws on a bare 404 (edge misroute) instead of reading it as no-instance", async () => {
    // Regression coverage: GET /me/instance clears local chat history when
    // getInstance returns null — a proxy/edge 404 without the structured
    // instance_not_found code must never masquerade as "instance destroyed".
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      json: async () => ({
        status: 404,
        code: "not_found",
        title: "Not found",
      }),
    });

    const { getInstance, HermesOrchestratorError } = await import(
      "./hermes-orchestrator.client"
    );

    await expect(getInstance("user_misrouted")).rejects.toBeInstanceOf(
      HermesOrchestratorError,
    );
  });

  it("wraps a raw fetch failure on onboard as HermesOrchestratorError without retrying", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { startInstanceOnboarding, HermesOrchestratorError } = await import(
      "./hermes-orchestrator.client"
    );

    await expect(
      startInstanceOnboarding("user_network_blip", {
        researchDepth: "deep",
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HermesOrchestratorError);
      expect(
        (error as InstanceType<typeof HermesOrchestratorError>).httpStatus,
      ).toBe(503);
      expect((error as Error).message).toContain("fetch failed");
      return true;
    });
    // Onboard is single-shot — no orchFetchWithRetry — so the user can click
    // Continue again without a silent second research/boot kickoff.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries provisionInstance on a transient 503 from the orchestrator edge, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce({
          status: 503,
          ok: false,
          json: async () => ({ code: "SERVICE_UNAVAILABLE" }),
        })
        .mockResolvedValueOnce({
          status: 503,
          ok: false,
          json: async () => ({ code: "SERVICE_UNAVAILABLE" }),
        })
        .mockResolvedValueOnce({
          status: 202,
          ok: true,
          json: async () => ({}),
        });

      const { provisionInstance } = await import(
        "./hermes-orchestrator.client"
      );

      const resultPromise = provisionInstance("user_deploy_window", {});
      await vi.runAllTimersAsync();

      await expect(resultPromise).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-transient 4xx (e.g. a genuine bad request)", async () => {
    fetchMock.mockResolvedValue({
      status: 400,
      ok: false,
      json: async () => ({ code: "BAD_REQUEST", title: "invalid userId" }),
    });

    const { provisionInstance, HermesOrchestratorError } = await import(
      "./hermes-orchestrator.client"
    );

    await expect(
      provisionInstance("user_bad_request", {}),
    ).rejects.toBeInstanceOf(HermesOrchestratorError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

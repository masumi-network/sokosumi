import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getPendingNoticesMock = vi.fn();
const acknowledgeNoticeMock = vi.fn();
const toCoreApiActionErrorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getPendingNotices: (...args: unknown[]) => getPendingNoticesMock(...args),
    acknowledgeNotice: (...args: unknown[]) => acknowledgeNoticeMock(...args),
  },
  toCoreApiActionError: (...args: unknown[]) =>
    toCoreApiActionErrorMock(...args),
}));

import { acknowledgeNoticeAction, getPendingNoticesAction } from "./action";

const NOTICES = [{ id: "notice-1", kind: "ANNOUNCEMENT" }];

describe("notice actions ActionResultDto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toCoreApiActionErrorMock.mockImplementation((error: unknown) => ({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Unexpected error",
    }));
  });

  it("maps pending notices to { ok: true, value } without a data field", async () => {
    getPendingNoticesMock.mockResolvedValue(NOTICES);

    const result = await getPendingNoticesAction();

    expect(result).toEqual({ ok: true, value: NOTICES });
    expect(result).not.toHaveProperty("data");
  });

  it("maps acknowledge success to { ok: true, value: undefined } without a data field", async () => {
    acknowledgeNoticeMock.mockResolvedValue({ id: "ack-1" });

    const result = await acknowledgeNoticeAction("notice-1");

    expect(acknowledgeNoticeMock).toHaveBeenCalledWith("notice-1");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(result).not.toHaveProperty("data");
  });

  it("maps Core failures to { ok: false, error }", async () => {
    getPendingNoticesMock.mockRejectedValue(new Error("boom"));

    const result = await getPendingNoticesAction();

    expect(result).toEqual({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
    });
  });
});

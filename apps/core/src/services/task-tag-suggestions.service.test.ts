import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueTaskTagReceipt,
  readCachedTaskTagSuggestions,
  suggestTaskTags,
  verifyTaskTagReceipt,
} from "./task-tag-suggestions.service";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  eval: vi.fn(),
  set: vi.fn(),
  redis: vi.fn(),
  classify: vi.fn(),
  available: vi.fn(),
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: mocks.redis }));
vi.mock("@/clients/task-tag-classifier", () => ({
  classifyTaskTags: mocks.classify,
  taskTagProviderAvailable: mocks.available,
  JEV_TASK_TAG_MODEL: "typesafe-ai/jev",
}));
const scope = { userId: "u1", workspaceId: "w1" };
const input = {
  name: "Research competitors",
  description: "Analyze market trends and prepare a detailed competitor report",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.redis.mockReturnValue({
    get: mocks.get,
    eval: mocks.eval,
    set: mocks.set,
  });
  mocks.get.mockResolvedValue(null);
  mocks.set.mockResolvedValue("OK");
  mocks.eval.mockResolvedValue(0);
  mocks.available.mockResolvedValue(true);
  mocks.classify.mockResolvedValue({ ok: true, tags: ["research"] });
});
describe("signed task tag receipts", () => {
  it("binds input, owner, workspace and accepts an empty complete result", () => {
    const receipt = issueTaskTagReceipt(scope, input, []);
    expect(verifyTaskTagReceipt(receipt, scope, input)).toEqual([]);
    expect(
      verifyTaskTagReceipt(receipt, { ...scope, userId: "other" }, input),
    ).toBeNull();
    expect(
      verifyTaskTagReceipt(receipt, { ...scope, workspaceId: "other" }, input),
    ).toBeNull();
    expect(
      verifyTaskTagReceipt(receipt, scope, { ...input, name: "Different" }),
    ).toBeNull();
    expect(verifyTaskTagReceipt(`${receipt}x`, scope, input)).toBeNull();
  });
  it("expires after fifteen minutes and tolerates whitespace only changes", () => {
    vi.useFakeTimers();
    const receipt = issueTaskTagReceipt(scope, input, ["research"]);
    expect(
      verifyTaskTagReceipt(receipt, scope, {
        ...input,
        name: " Research   competitors ",
      }),
    ).toEqual(["research"]);
    vi.advanceTimersByTime(900_001);
    expect(verifyTaskTagReceipt(receipt, scope, input)).toBeNull();
    vi.useRealTimers();
  });
});
describe("suggestion spend protection", () => {
  it("does no provider work without Redis or when Redis fails", async () => {
    mocks.redis.mockReturnValue(null);
    await expect(suggestTaskTags(scope, input)).rejects.toMatchObject({
      status: 503,
    });
    mocks.redis.mockReturnValue({ get: mocks.get });
    mocks.get.mockRejectedValue(new Error("unavailable"));
    await expect(suggestTaskTags(scope, input)).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.available).not.toHaveBeenCalled();
  });
  it("reuses a validated scoped cache result without budget or provider work", async () => {
    const receipt = issueTaskTagReceipt(scope, input, []);
    mocks.get.mockResolvedValue(receipt);
    expect(await suggestTaskTags(scope, input)).toEqual({ tags: [], receipt });
    expect(mocks.eval).not.toHaveBeenCalled();
    expect(mocks.classify).not.toHaveBeenCalled();
  });
  it("returns retry timing when atomic admission denies budget or concurrent content", async () => {
    mocks.eval.mockResolvedValueOnce(5);
    await expect(suggestTaskTags(scope, input)).rejects.toMatchObject({
      status: 429,
      cause: { retryAfterSeconds: 5 },
    });
    expect(mocks.classify).not.toHaveBeenCalled();
  });
  it("reuses a result completed between cache read and admission", async () => {
    const receipt = issueTaskTagReceipt(scope, input, ["research"]);
    mocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce(receipt);
    mocks.eval.mockResolvedValueOnce(-1);
    expect(await suggestTaskTags(scope, input)).toEqual({
      tags: ["research"],
      receipt,
    });
    expect(mocks.classify).not.toHaveBeenCalled();
  });
  it("bounds a hanging Redis read and performs no provider work", async () => {
    vi.useFakeTimers();
    mocks.get.mockReturnValue(new Promise(() => {}));
    const result = expect(suggestTaskTags(scope, input)).rejects.toMatchObject({
      status: 503,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await result;
    expect(mocks.classify).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("stops provider work when discovery is unavailable and releases its own lease", async () => {
    mocks.available.mockResolvedValue(false);
    await expect(suggestTaskTags(scope, input)).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.eval).toHaveBeenCalledTimes(2);
    expect(mocks.eval.mock.calls[1]![3]).toEqual(
      mocks.eval.mock.calls[0]!.at(-1),
    );
  });
  it("rejects an invalid cached receipt without trusting its tags", async () => {
    mocks.get.mockResolvedValue("forged");
    mocks.eval.mockResolvedValueOnce(-1);
    await expect(suggestTaskTags(scope, input)).rejects.toMatchObject({
      status: 503,
    });
    expect(mocks.classify).not.toHaveBeenCalled();
  });
  it("signs and caches successful classification; provider failure stays safe", async () => {
    const response = await suggestTaskTags(scope, input);
    expect(verifyTaskTagReceipt(response.receipt, scope, input)).toEqual([
      "research",
    ]);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.any(String),
      response.receipt,
      "EX",
      900,
    );
    mocks.classify.mockRejectedValue(new Error("private provider body"));
    await expect(suggestTaskTags(scope, input)).rejects.toMatchObject({
      status: 503,
      message: "Tag suggestions are temporarily unavailable",
    });
  });
});

describe("create-time cached suggestions", () => {
  it.each([{ tags: [] }, { tags: ["research"] }] as const)(
    "reuses signed cached result $tags without provider work",
    async ({ tags }) => {
      mocks.get.mockResolvedValue(issueTaskTagReceipt(scope, input, [...tags]));
      expect(await readCachedTaskTagSuggestions(scope, input)).toEqual(tags);
      expect(mocks.available).not.toHaveBeenCalled();
      expect(mocks.classify).not.toHaveBeenCalled();
      expect(mocks.eval).not.toHaveBeenCalled();
    },
  );
  it("ignores receipts for other input or workspace", async () => {
    mocks.get.mockResolvedValue(
      issueTaskTagReceipt(scope, input, ["research"]),
    );
    expect(
      await readCachedTaskTagSuggestions(scope, { ...input, name: "Other" }),
    ).toBeNull();
    expect(
      await readCachedTaskTagSuggestions(
        { ...scope, workspaceId: "other" },
        input,
      ),
    ).toBeNull();
  });
  it("fails open to normal creation when Redis is missing or unavailable", async () => {
    mocks.redis.mockReturnValueOnce(null);
    expect(await readCachedTaskTagSuggestions(scope, input)).toBeNull();
    mocks.get.mockRejectedValue(new Error("redis unavailable"));
    expect(await readCachedTaskTagSuggestions(scope, input)).toBeNull();
  });
  it("limits a hanging read to 250ms", async () => {
    vi.useFakeTimers();
    mocks.get.mockReturnValue(new Promise(() => {}));
    const pending = readCachedTaskTagSuggestions(scope, input);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toBeNull();
    vi.useRealTimers();
  });
});

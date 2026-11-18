import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueTaskTagReceipt,
  readCachedTaskTagEvaluation,
  readCachedTaskTagSuggestions,
  suggestTaskTags,
  verifyTaskTagEvaluationReceipt,
  verifyTaskTagReceipt,
} from "./task-tag-suggestions.service";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  eval: vi.fn(),
  set: vi.fn(),
  redis: vi.fn(),
  classify: vi.fn(),
  available: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock("@/helpers/task-tag-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/task-tag-catalog")>()),
  loadTaskTagCatalog: mocks.catalog,
}));
vi.mock("@/lib/redis", () => ({ getRedisClient: mocks.redis }));
vi.mock("@/clients/task-tag-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/task-tag-classifier")>()),
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
  mocks.catalog.mockResolvedValue([]);
  mocks.available.mockResolvedValue(true);
  mocks.classify.mockResolvedValue({
    ok: true,
    tags: ["research"],
    workspaceSuggestions: [],
  });
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
  it("charges the shared user limits for every planned batch across workspaces", async () => {
    const labels = Array.from({ length: 65 }, (_, i) => ({
      id: `019a1000-aaaa-7000-8000-${String(i).padStart(12, "0")}`,
      displayName: `Tag ${i}`,
      description: null,
      color: null,
      vocabularyVersion: 1,
    }));
    mocks.catalog.mockResolvedValue(labels);
    mocks.eval.mockResolvedValue(9);
    for (const workspaceId of ["first", "second"])
      await expect(
        suggestTaskTags({ ...scope, workspaceId }, input),
      ).rejects.toMatchObject({ status: 429 });
    const first = mocks.eval.mock.calls[0]!;
    const second = mocks.eval.mock.calls[1]!;
    expect(first.at(-2)).toBe(3); // 65 workspace tags and 17 built-in topics.
    expect(first.slice(3, 6)).toEqual(second.slice(3, 6)); // cooldown, minute and hour per user.
    expect(first[6]).not.toBe(second[6]); // workspace budget.
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

describe("workspace suggestion receipts", () => {
  const label = {
    id: "019a1000-aaaa-7000-8000-000000000001",
    displayName: "Localization",
    description: "Language services",
    color: "teal" as const,
    vocabularyVersion: 4,
  };
  const candidate = {
    id: label.id,
    displayName: label.displayName,
    color: label.color,
    autoApply: false,
  };
  it("signs the offered state and restores the version from the current authorized vocabulary", async () => {
    mocks.catalog.mockResolvedValue([label]);
    mocks.classify.mockResolvedValue({
      ok: true,
      tags: ["research"],
      workspaceSuggestions: [{ ...candidate, vocabularyVersion: 4 }],
    });
    const { receipt, workspaceSuggestions } = await suggestTaskTags(
      scope,
      input,
    );
    expect(workspaceSuggestions).toEqual([candidate]);
    expect(mocks.catalog).toHaveBeenCalledWith(scope.workspaceId);
    expect(mocks.classify).toHaveBeenCalledWith(
      input.name,
      input.description,
      expect.any(AbortSignal),
      [label],
    );
    const expected = {
      tags: ["research"],
      workspaceSuggestions: [{ ...candidate, vocabularyVersion: 4 }],
    };
    expect(
      verifyTaskTagEvaluationReceipt(receipt, scope, input, [label]),
    ).toEqual(expected);
    const [encoded, mac] = receipt.split(".");
    const payload = JSON.parse(Buffer.from(encoded!, "base64url").toString());
    payload.workspaceTags[0][1] = true;
    const forged =
      Buffer.from(JSON.stringify(payload)).toString("base64url") + "." + mac;
    expect(
      verifyTaskTagEvaluationReceipt(forged, scope, input, [label]),
    ).toBeNull();
    expect(
      verifyTaskTagEvaluationReceipt(
        receipt,
        { ...scope, workspaceId: "other" },
        input,
        [label],
      ),
    ).toBeNull();
    mocks.get.mockResolvedValue(receipt);
    expect(await readCachedTaskTagEvaluation(scope, input, [label])).toEqual(
      expected,
    );
    const validKey = mocks.get.mock.lastCall?.[0];
    const recolored = [
      { ...label, color: "pink" as const, customColor: "#127DA2" },
    ];
    expect(
      await readCachedTaskTagEvaluation(scope, input, recolored),
    ).toMatchObject({
      workspaceSuggestions: [{ color: "pink", customColor: "#127DA2" }],
    });
    expect(mocks.get.mock.lastCall?.[0]).toBe(validKey);
    for (const changed of [
      [],
      [{ ...label, vocabularyVersion: 5 }],
      [{ ...label, displayName: "Renamed" }],
      [label, { ...label, id: "019a1000-aaaa-7000-8000-000000000002" }],
    ]) {
      expect(
        await readCachedTaskTagEvaluation(scope, input, changed),
      ).toBeNull();
      expect(mocks.get.mock.lastCall?.[0]).not.toBe(validKey);
    }
    mocks.get.mockResolvedValue(forged);
    expect(await readCachedTaskTagEvaluation(scope, input, [label])).toBeNull();
  });
});

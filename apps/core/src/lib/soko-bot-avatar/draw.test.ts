import { beforeEach, describe, expect, it, vi } from "vitest";

const rewriteMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/soko-bot-avatar/provider", () => ({
  AVATAR_IMAGE_MODEL: "test/image",
  ImageTimeoutError: class ImageTimeoutError extends Error {},
  avatarProvider: () => ({ rewrite: rewriteMock }),
}));

// planChange does not touch media; keep ffmpeg-static out of this suite.
vi.mock("@/lib/soko-bot-avatar/media", () => ({
  levelStill: vi.fn(),
}));

import { planChange } from "./draw";
import { freshLook, CRAFTED_DESK_STYLE as style } from "./style";

describe("planChange", () => {
  const base = freshLook(style);

  beforeEach(() => {
    rewriteMock.mockReset();
  });

  it("shuffles into a fresh seeded look", async () => {
    const plan = await planChange(style, base, { kind: "shuffle" });
    expect(plan.kind).toBe("edit");
    if (plan.kind !== "edit") return;
    expect(plan.look.creature).toBeTruthy();
    expect(plan.prompt.length).toBeGreaterThan(0);
  });

  it("swaps the creature and clears typed changes", async () => {
    const other = style.creatures.find((one) => one.id !== base.creature);
    expect(other).toBeTruthy();
    const withTyped = { ...base, typed: ["a prior edit"] };
    const plan = await planChange(style, withTyped, {
      kind: "creature",
      creature: other!.id,
    });
    expect(plan).toMatchObject({
      kind: "edit",
      note: "",
      look: { creature: other!.id, typed: [] },
    });
  });

  it("leaves the look alone when the creature is already worn", async () => {
    const plan = await planChange(style, base, {
      kind: "creature",
      creature: base.creature,
    });
    expect(plan).toEqual({ kind: "unchanged", note: "" });
  });

  it("adds and removes an accessory", async () => {
    const accessory = style.accessories[0]!;
    const added = await planChange(style, base, {
      kind: "accessory",
      accessory: accessory.id,
      enabled: true,
    });
    expect(added.kind).toBe("edit");
    if (added.kind !== "edit") return;
    expect(added.look.accessories).toContain(accessory.id);

    const removed = await planChange(style, added.look, {
      kind: "accessory",
      accessory: accessory.id,
      enabled: false,
    });
    expect(removed.kind).toBe("edit");
    if (removed.kind !== "edit") return;
    expect(removed.look.accessories).not.toContain(accessory.id);
  });

  it("keeps the look when a typed change is refused", async () => {
    rewriteMock.mockResolvedValue({
      edit: "",
      note: "That looks like a brand.",
    });
    const plan = await planChange(style, base, {
      kind: "typed",
      text: "make it Nike",
    });
    expect(plan).toEqual({
      kind: "unchanged",
      note: "That looks like a brand.",
    });
    expect(rewriteMock).toHaveBeenCalledOnce();
  });

  it("applies an allowed typed change and keeps the note", async () => {
    rewriteMock.mockResolvedValue({
      edit: "Add a tiny paper boat on the desk.",
      note: "Added a paper boat.",
    });
    const plan = await planChange(style, base, {
      kind: "typed",
      text: "put a paper boat on the desk",
    });
    expect(plan).toMatchObject({
      kind: "edit",
      note: "Added a paper boat.",
      prompt: "Add a tiny paper boat on the desk.",
      look: { typed: ["Add a tiny paper boat on the desk."] },
    });
  });
});

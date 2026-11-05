import { describe, expect, it } from "vitest";

import type { TransactionHistoryItem } from "@/lib/services/history.service";

import { groupSokoBotTurns } from "./group-soko-bot-turns";

const day = (date: Date) => date.toISOString().slice(0, 10);

function turn(id: string, at: string, sokoBotId = "joseph") {
  return {
    id,
    kind: "sokoBot",
    sokoBotId,
    title: "Joseph",
    description: null,
    credits: 0.5,
    consumedAt: new Date(at),
    projectId: null,
    owner: null,
  } as TransactionHistoryItem;
}

function task(id: string, at: string) {
  return {
    id,
    kind: "unattributed",
    title: id,
    description: null,
    credits: 10,
    consumedAt: new Date(at),
    projectId: null,
    owner: null,
    bucketSource: null,
  } as TransactionHistoryItem;
}

describe("groupSokoBotTurns", () => {
  it("folds one bot's day into a single entry where its newest turn was", () => {
    const entries = groupSokoBotTurns(
      [
        turn("t1", "2026-10-23T16:00:00Z"),
        task("task-a", "2026-10-23T15:00:00Z"),
        turn("t2", "2026-10-23T14:00:00Z"),
        turn("t3", "2026-10-23T09:00:00Z"),
        task("task-b", "2026-10-22T12:00:00Z"),
      ],
      day,
    );
    expect(
      entries.map((entry) =>
        entry.type === "item" ? entry.item.id : entry.items.map((i) => i.id),
      ),
    ).toEqual([["t1", "t2", "t3"], "task-a", "task-b"]);
    expect(entries[0]).toMatchObject({ type: "sokoBotDay", credits: 1.5 });
  });

  it("keeps different days, different bots and a lone turn apart", () => {
    const entries = groupSokoBotTurns(
      [
        turn("a1", "2026-10-23T10:00:00Z"),
        turn("b1", "2026-10-23T09:00:00Z", "lili"),
        turn("a2", "2026-10-23T08:00:00Z"),
        turn("a3", "2026-10-22T08:00:00Z"),
      ],
      day,
    );
    expect(entries.map((entry) => entry.type)).toEqual([
      "sokoBotDay",
      "item",
      "item",
    ]);
    expect(
      entries.map((entry) =>
        entry.type === "item" ? entry.item.id : entry.key,
      ),
    ).toEqual(["joseph:2026-10-23", "b1", "a3"]);
  });
});

import { describe, expect, it } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { appendUniqueTasks } from "./task-pages";

const task = (id: string) => ({ id }) as TaskWithCoworker;

describe("appendUniqueTasks", () => {
  it("skips a loaded page row that is already on the board", () => {
    const merged = appendUniqueTasks(
      [task("a"), task("b")],
      [task("b"), task("c")],
    );

    expect(merged.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});

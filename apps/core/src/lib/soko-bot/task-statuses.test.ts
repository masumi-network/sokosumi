import { TaskStatus } from "@sokosumi/database";
import { SOKO_BOT_TASK_STATUSES } from "@sokosumi/soko-bot";
import { expect, it } from "vitest";

it("offers the bot every Task status Core stores", () => {
  expect([...SOKO_BOT_TASK_STATUSES].sort()).toEqual(
    Object.values(TaskStatus).sort(),
  );
});

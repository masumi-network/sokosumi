import { SOKO_BOT_TASK_STATUSES } from "@sokosumi/soko-bot";
import { expect, it } from "vitest";
import { taskStatusSchema } from "@/schemas/domain-enums.schema";

it("offers the bot every Task status except the event-only CREATED", () => {
  expect([...SOKO_BOT_TASK_STATUSES].sort()).toEqual(
    [...taskStatusSchema.options].sort(),
  );
});

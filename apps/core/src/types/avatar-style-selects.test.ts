import { workCreatorInclude } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { chatRoomSokoBotSelect } from "@/routes/v1/chats/rooms/soko-bot-participant";
import { taskEventApiInclude } from "@/types/task";

// A bot's avatar style rides on the query that already loads the bot, as a
// relation select, so listing many bots never costs a read per bot.
describe("Soko Bot summaries load the avatar style with the bot", () => {
  it.each([
    ["task and event bots", taskEventApiInclude.sokoBot.select],
    [
      "work creators (task, schedule, job)",
      workCreatorInclude.creatorSokoBot.select,
    ],
  ])("%s", (_name, select) => {
    expect(select.avatar).toEqual({ select: { styleId: true } });
  });

  it("chat room bots load Idle and Working loops for the participant chip", () => {
    expect(chatRoomSokoBotSelect.avatar).toEqual({
      select: {
        styleId: true,
        renders: {
          where: { state: { in: ["IDLE", "WORKING"] } },
          select: { state: true, loopUrl: true },
        },
      },
    });
  });
});

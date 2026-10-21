import { z } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import {
  memberSokoBot,
  type ResolvedSokoBotRow,
  type SokoBotSelector,
} from "@/helpers/soko-bot-resolver";

export const sokoBotIdParams = z.object({
  sokoBotId: z
    .string()
    .uuid()
    .openapi({ param: { name: "sokoBotId", in: "path" } }),
});

export function sokoBotIdSelector(params: {
  sokoBotId: string;
}): SokoBotSelector {
  return { kind: "id", sokoBotId: params.sokoBotId };
}

/** The bot a member reaches by id; someone else's personal bot is a 404. */
export async function requireReachableSokoBot(
  userId: string,
  workspaceId: string,
  sokoBotId: string,
): Promise<ResolvedSokoBotRow> {
  const bot = await memberSokoBot(userId, workspaceId, {
    kind: "id",
    sokoBotId,
  });
  if (!bot) throw notFound("Soko Bot not found");
  return bot;
}

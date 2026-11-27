import prisma from "@/lib/db/prisma";
import type { ReferenceScript, ScriptedToolCall } from "./world-check";

/**
 * Reference runs for the dev owner journeys, by journey id: the tool calls a
 * correct bot makes, played with no model by the world check. They are eval
 * fixtures, not bot code: ids come from the tools' own results, or, for a
 * project the owner names, from the turn's workspace. Held-out scripts stay
 * with the evaluator.
 */

async function projectId(turnId: string, name: string): Promise<string> {
  const { workspaceId } = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: { workspaceId: true },
  });
  const project = await prisma.project.findFirstOrThrow({
    where: { workspaceId, name },
    select: { id: true },
  });
  return project.id;
}

type Results = readonly unknown[];

/** The newest result of a tool call that returned `key`. */
function latest<T>(results: Results, key: string): T {
  const found = [...results]
    .reverse()
    .find((result) => result && typeof result === "object" && key in result);
  if (!found) throw new Error(`World check: no tool result with "${key}"`);
  return (found as Record<string, T>)[key]!;
}

const call = (
  tool: string,
  input: Record<string, unknown>,
): ScriptedToolCall => ({
  tool,
  input,
});

const X_POSTS_FROM_PDF = [
  "Soko Bots now keep typed memory: every entry is dated, so you can see what it learned and when.",
  "When a fact changes, the old memory entry is marked Replaced instead of silently overwritten.",
  "Each night the bot's dreaming pass tidies its memory, so tomorrow starts from what is still true.",
];

export const REFERENCE_SCRIPTS: Record<string, ReferenceScript> = {
  "owner-pdf-to-x-posts": {
    turns: [
      {
        match: "Typed memory launch",
        route: { route: "MANAGE_WORK", writeScope: "SOCIAL" },
        steps: [
          async (_results, { turnId }) => [
            call("list_files", { query: "Typed memory launch" }),
            call("list_project_social_accounts", {
              projectId: await projectId(turnId, "Sokosumi Marketing"),
            }),
          ],
          (results) => [
            call("read_file", {
              fileId: latest<{ id: string }[]>(results, "files")[0]!.id,
            }),
          ],
          async (results, { turnId }) => {
            const account = latest<{ id: string; provider: string }[]>(
              results,
              "accounts",
            ).find((each) => each.provider === "x")!;
            const project = await projectId(turnId, "Sokosumi Marketing");
            return X_POSTS_FROM_PDF.map((text) =>
              call("create_social_post", {
                projectId: project,
                socialConnectionId: account.id,
                text,
              }),
            );
          },
          () =>
            "Three X drafts for Sokosumi are ready for your approval: Monday, Wednesday and Friday next week.",
        ],
      },
    ],
  },
};

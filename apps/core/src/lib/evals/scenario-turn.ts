import prisma from "@/lib/db/prisma";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import { withEvaluationActor } from "@/lib/soko-bot/evaluation-dispatch";
import { SokoBotRefusedUnsentError } from "@/services/soko-bot-runtime.service";
import { currentMailboxFixture } from "./mailbox-binding";

const FIXTURE_READ_TOOLS = new Set([
  "list_integrations",
  "find_integrations",
  "search_inbox",
  "read_email",
  "list_calendar_events",
]);
const FIXTURE_MUTATION_TOOLS = new Set([
  "update_emails",
  "draft_email",
  "save_email_attachment",
  "send_email_draft",
]);

export function scopesMailboxFixture(capability: string): boolean {
  return (
    FIXTURE_READ_TOOLS.has(capability) ||
    FIXTURE_MUTATION_TOOLS.has(capability) ||
    capability.includes("integration")
  );
}

/** Restore trusted evaluation identity after an HTTP request or a resumed tick. */
export async function withEvalScenarioTurn<T>(
  turnId: string,
  run: () => T,
  capability?: string,
): Promise<Awaited<T>> {
  const turn = await prisma.sokoBotTurn
    .findUnique({
      where: { id: turnId },
      select: {
        sokoBotId: true,
        clientTurnId: true,
        source: true,
        requestedByUserId: true,
        sokoBot: { select: { userId: true } },
      },
    })
    .catch(() => {
      throw new SokoBotRefusedUnsentError(
        "Evaluation turn could not be verified before dispatch",
      );
    });
  if (!turn)
    throw new SokoBotRefusedUnsentError(
      "Evaluation turn is unavailable before dispatch",
    );
  if (!turn.clientTurnId?.startsWith("lab:eval:")) return await run();
  return await withEvaluationActor(
    {
      userId: sokoBotActingUserId(turn),
      sokoBotId: turn.sokoBotId,
      clientTurnId: turn.clientTurnId,
      source: turn.source,
    },
    async () => {
      const fixture = await currentMailboxFixture().catch(() => {
        throw new SokoBotRefusedUnsentError(
          "Mailbox evaluation scope could not be verified before dispatch",
        );
      });
      if (
        fixture &&
        capability &&
        !FIXTURE_READ_TOOLS.has(capability) &&
        (FIXTURE_MUTATION_TOOLS.has(capability) ||
          capability.includes("integration"))
      )
        throw new SokoBotRefusedUnsentError(
          "Mailbox evaluation permits read-only provider access",
        );
      return await run();
    },
  );
}

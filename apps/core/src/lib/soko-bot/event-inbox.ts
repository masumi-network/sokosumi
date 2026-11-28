import type { Prisma } from "@sokosumi/database";
import type { Network } from "@/lib/network";
import type { StartSokoBotTurnInput } from "./turn-start";

type InboxDb = Pick<Prisma.TransactionClient, "sokoBotEventInbox">;

export function consumedEventOccurrences(
  db: InboxDb,
  botId: string,
  network: Network,
  eventIds: string[],
) {
  return db.sokoBotEventInbox.findMany({
    where: {
      botId,
      eventId: { in: eventIds },
      OR: [
        { purpose: "TASK_EVENT" },
        {
          purpose: "JOB_EVENT",
          OR:
            network === "mainnet"
              ? [{ network: "mainnet" }, { network: null }]
              : [{ network }],
        },
      ],
    },
    select: { eventId: true, purpose: true },
  });
}

export function reserveEventOccurrence(
  tx: InboxDb,
  botId: string,
  turnId: string,
  network: Network,
  occurrence: NonNullable<StartSokoBotTurnInput["eventBatch"]>[number],
) {
  return tx.sokoBotEventInbox.create({
    data: {
      botId,
      turnId,
      network: occurrence.purpose === "JOB_EVENT" ? network : null,
      eventId: occurrence.eventId,
      entityId: occurrence.entityId,
      purpose: occurrence.purpose,
      designatedHandlerBotId: occurrence.designatedHandlerBotId,
    },
  });
}

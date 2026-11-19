import type { TaskDomainActor } from "./task-domain.service";

/** The TaskEvent actor columns for a domain actor; exactly one is set. */
export function eventActorFields(actor: TaskDomainActor) {
  switch (actor.kind) {
    case "user":
      return {
        userId: actor.userId,
        coworkerId: null,
        sokoBotId: null,
      };
    case "coworker":
      return {
        userId: null,
        coworkerId: actor.coworkerId,
        sokoBotId: null,
      };
    case "soko_bot":
      return {
        userId: null,
        coworkerId: null,
        sokoBotId: actor.sokoBotId,
      };
  }
}

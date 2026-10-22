import type { Context } from "hono";
import type { EnvVariables } from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import type { ContactListQuery } from "@/schemas/contact.schema";
import {
  type ContactActor,
  type ListContactsOptions,
  resolveContactActor,
} from "@/services/contacts.service";

export function contactActor(c: Context<EnvVariables>): Promise<ContactActor> {
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  return resolveContactActor(c.var.authContext, workspace.workspaceId);
}

function flag(value: "true" | "false" | undefined): boolean | undefined {
  return value === undefined ? undefined : value === "true";
}

/** The list query's params as service options. */
export function contactQueryOptions(
  query: ContactListQuery,
): Omit<ListContactsOptions, "cursor" | "limit"> {
  return {
    filter: {
      search: query.search,
      stages: query.stage ? [query.stage] : undefined,
      ownerUserId: query.ownerUserId,
      ownedByMe: flag(query.ownedByMe),
      knownByUserId: query.knownByUserId,
      knownByMe: flag(query.knownByMe),
      lastContactAfter: query.lastContactAfter,
      lastContactBefore: query.lastContactBefore,
      lastContactOlderThanDays: query.lastContactOlderThanDays,
      createdWithinDays: query.createdWithinDays,
      followUpDue: flag(query.followUpDue),
      hasChannel: query.hasChannel,
      hasInteractions: flag(query.hasInteractions),
    },
    listId: query.listId,
    archived: query.archived === "true",
    sort: query.sort,
    direction: query.direction,
  };
}

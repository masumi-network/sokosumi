import { type Project } from "@sokosumi/database";
import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { createDataTable, resolveTableActor } from "@/helpers/data-table";
import { loadSokoBotTurnAuthContext } from "@/helpers/soko-bot-turn-auth-context";
import { contactExportTable } from "@/lib/contacts/export-table";
import prisma from "@/lib/db/prisma";
import { globalCoworkersFor } from "@/lib/evals/eval-guard";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import {
  isContactCapability,
  runContactTool,
} from "@/lib/soko-bot/contact-tools";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  enrichContactFromWeb,
  findPeopleForList,
} from "@/services/contact-suggestions.service";
import { listContacts } from "@/services/contacts.service";
import { createProject, updateProject } from "@/services/projects.service";
import { listSokoBotIntegrationsForBot } from "@/services/soko-bot-integration-list.service";
import { searchSokoBotIntegrationCatalog } from "@/services/soko-bot-integrations.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf, requireSokoBotWorkspaceAccess } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

export async function tableActor(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  rawInput: unknown,
) {
  const auth = await loadSokoBotTurnAuthContext(authorized.turn);
  if (!auth)
    throw new SokoBotRuntimeAuthorizationError("Soko Bot is unavailable");
  const actor = await resolveTableActor(auth, auth.workspaceId);
  const { taskId } = z
    .object({ taskId: z.string().max(200).optional() })
    .parse(rawInput);
  const ownerChat =
    authorized.turn.source === "CHAT" &&
    authorized.askedByKind !== "ASSISTANT" &&
    authorized.turn.chainDepth === 0;
  if (!ownerChat && !taskId)
    throw new SokoBotRuntimeAuthorizationError(
      "Task-driven table operations require an assigned taskId",
    );
  return { ...actor, taskId, ownerChat };
}

/**
 * Contacts are the workspace's shared set: a bot reads and writes them as
 * the member its turn acts for, personal and shared bots alike.
 */
export async function executeContactTool(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  const { capability } = input;
  if (!isContactCapability(capability))
    throw new SokoBotRuntimeValidationError("Not a contacts tool");
  const userId = actingMemberOf(authorized);
  await requireSokoBotWorkspaceAccess(
    prisma,
    userId,
    authorized.turn.workspaceId,
  );
  const actor = {
    workspaceId: authorized.turn.workspaceId,
    userId,
    sokoBotId: authorized.turn.sokoBotId,
  };
  return runContactTool(capability, input.input, actor, {
    authorize: (tx) =>
      runtime.requireMutationAuthority(tx, authorized, false, capability),
    commit: (tx, targetId, result) =>
      commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId: input.toolCallId,
        actorBotId: authorized.turn.sokoBotId,
        targetId,
        result: persistedToolResult(result),
      }),
  });
}

/**
 * The contacts a filter matches as a new Files table: created with its
 * first rows under this call's receipt, then filled in batches.
 */
export async function exportContactsToTable(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  const {
    title,
    limit,
    taskId: _taskId,
    query,
    mode,
    company,
    listId,
    archived,
    ...filter
  } = SOKO_BOT_TOOL_INPUT_SCHEMAS.export_contacts_to_table.parse(input.input);
  const userId = actingMemberOf(authorized);
  await requireSokoBotWorkspaceAccess(
    prisma,
    userId,
    authorized.turn.workspaceId,
  );
  const contactActor = {
    workspaceId: authorized.turn.workspaceId,
    userId,
    sokoBotId: authorized.turn.sokoBotId,
  };
  const contacts = [];
  let cursor: string | undefined;
  while (contacts.length < limit) {
    const page = await listContacts(contactActor, {
      filter,
      query,
      mode,
      company,
      listId,
      archived,
      sort: "lastContactAt",
      cursor,
      limit: Math.min(100, limit - contacts.length),
    });
    contacts.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const key = `contacts-export:${input.turnId}:${input.toolCallId}`;
  const table = contactExportTable(contacts, key);
  const actor = await runtime.tableActor(authorized, input.input);
  // One transaction: the table, every row, the authority check and the
  // receipt happen together or not at all, so a retry starts clean.
  const created = await createDataTable(
    actor,
    {
      key,
      title,
      description: `${contacts.length} contacts from the team's Contacts.`,
      columns: table.columns,
      rows: table.rows,
    },
    async (tx, operation) => {
      await runtime.requireMutationAuthority(
        tx,
        authorized,
        false,
        input.capability,
        { taskIds: actor.taskId ? [actor.taskId] : [] },
      );
      await commitActionReceipt(tx, {
        turnId: authorized.turn.id,
        toolCallId: input.toolCallId,
        actorBotId: actor.actorId,
        targetId: operation.tableId,
        disposition: operation.replayed ? "ALREADY_SATISFIED" : "APPLIED",
        result: persistedToolResult({
          table: { id: operation.tableId, title },
          url: `/drive/tables/${operation.tableId}`,
          rows: table.rows.length,
        }),
      });
    },
    { manyRows: true },
  );
  return {
    table: { id: created.id, title: created.title },
    url: `/drive/tables/${created.id}`,
    rows: table.rows.length,
    instruction: "Table created. Present this link now.",
  };
}

/** AI Coworkers this bot may hand Task work to. */
export async function findCoworkers(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  query: string | undefined,
) {
  return prisma.coworker.findMany({
    where: {
      archivedAt: null,
      AND: [
        {
          OR: [
            ...(await globalCoworkersFor(authorized.turn.workspaceId)),
            // A shared bot sees no member's private assignments.
            ...(authorized.reader.sharedScope
              ? []
              : [
                  {
                    assignments: {
                      some: { userId: actingMemberOf(authorized) },
                    },
                  },
                ]),
            {
              workspaceAccess: {
                some: {
                  workspaceId: authorized.turn.workspaceId,
                  status: "GRANTED",
                },
              },
            },
          ],
        },
        ...(query
          ? [
              {
                OR: [
                  {
                    name: {
                      contains: query,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    description: {
                      contains: query,
                      mode: "insensitive" as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    },
    take: 20,
    select: {
      id: true,
      name: true,
      caption: true,
      description: true,
      capabilities: true,
    },
  });
}

/** People on the workspace's team, by name or email: who a Task may go to. */
export async function findTeammates(
  runtime: RuntimeOperations,
  workspaceId: string,
  query: string | undefined,
) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { userId: true, organizationId: true },
  });
  const team = [
    ...(workspace?.userId ? [{ id: workspace.userId }] : []),
    ...(workspace?.organizationId
      ? [{ members: { some: { organizationId: workspace.organizationId } } }]
      : []),
  ];
  if (team.length === 0) return [];
  const people = await prisma.user.findMany({
    where: {
      OR: team,
      ...(query
        ? {
            AND: {
              OR: [
                { name: { contains: query, mode: "insensitive" as const } },
                { email: { contains: query, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    take: 20,
    select: { id: true, name: true, email: true },
  });
  return people.map((person) => ({
    userId: person.id,
    name: person.name,
    email: person.email,
  }));
}

/**
 * The CRM's paid web lookups, Find people and Enrich, billed to the member
 * the bot acts for like the buttons.
 */
export async function executeContactResearch(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  const capability = input.capability as "find_people" | "enrich_contact";
  const { turn } = authorized;
  const userId = actingMemberOf(authorized);
  await requireSokoBotWorkspaceAccess(prisma, userId, turn.workspaceId);
  const actor = {
    workspaceId: turn.workspaceId,
    userId,
    sokoBotId: turn.sokoBotId,
  };
  try {
    if (capability === "find_people") {
      const { listId, ...search } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.find_people.parse(input.input);
      const result = await findPeopleForList(actor, listId, search);
      return runtime.commitReceipt(authorized, input.toolCallId, listId, {
        listId,
        found: result.found,
        credits: result.credits,
        people: result.suggestions.map((person) => ({
          name: person.name,
          role: person.role,
          organization: person.organization,
          location: person.location,
          reason: person.reason,
          profileUrl: person.profileUrl,
        })),
        link: `/contacts?list=${listId}`,
      });
    }
    const { contactId } = SOKO_BOT_TOOL_INPUT_SCHEMAS.enrich_contact.parse(
      input.input,
    );
    const result = await enrichContactFromWeb(actor, contactId);
    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
      select: { name: true },
    });
    return runtime.commitReceipt(authorized, input.toolCallId, contactId, {
      contact: { id: contactId, name: contact.name },
      ...result,
    });
  } catch (error) {
    if (error instanceof HTTPException && error.status < 500)
      throw new SokoBotRefusedUnsentError(error.message);
    throw error;
  }
}

/**
 * Projects belong to the workspace: a bot creates and edits them for the
 * member who asked, the same way that member would on the Projects page.
 */
export async function executeProjectTool(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  const { workspaceId } = authorized.turn;
  await requireSokoBotWorkspaceAccess(
    prisma,
    actingMemberOf(authorized),
    workspaceId,
  );
  let project: Project;
  try {
    if (input.capability === "create_project") {
      project = await createProject(
        workspaceId,
        SOKO_BOT_TOOL_INPUT_SCHEMAS.create_project.parse(input.input),
      );
    } else {
      const { projectId, ...fields } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.update_project.parse(input.input);
      project = await updateProject(workspaceId, projectId, fields);
    }
  } catch (error) {
    if (error instanceof HTTPException && error.status < 500)
      throw new SokoBotRefusedUnsentError(error.message);
    throw error;
  }
  return runtime.commitReceipt(authorized, input.toolCallId, project.id, {
    projectId: project.id,
    name: project.name,
    identifier: project.identifier,
    websiteUrl: project.websiteUrl,
    hasBriefing: Boolean(project.briefing),
    link: `/projects/${project.id}`,
  });
}

/**
 * Apps the bot could be connected to, with a link to its own page that
 * offers the one-click connect; connecting stays the person's click.
 */
export async function findIntegrations(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  query: string,
) {
  const { sokoBotId } = authorized.turn;
  const [catalog, { integrations }, bot] = await Promise.all([
    searchSokoBotIntegrationCatalog(query, 10),
    listSokoBotIntegrationsForBot(sokoBotId),
    prisma.sokoBot.findUnique({
      where: { id: sokoBotId },
      select: { userId: true },
    }),
  ]);
  const page = bot?.userId ? "/personal-assistant" : `/soko-bots/${sokoBotId}`;
  return {
    apps: catalog.map((entry) => {
      const status =
        integrations.find(
          (integration) => integration.provider === entry.provider,
        )?.status ?? "DISCONNECTED";
      return {
        provider: entry.provider,
        name: entry.name,
        description: entry.description,
        status,
        connectLink:
          status === "ACTIVE"
            ? null
            : `${page}?connect=${encodeURIComponent(entry.provider)}`,
      };
    }),
  };
}

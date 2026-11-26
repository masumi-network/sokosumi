import {
  getSokoBotVersion,
  isCmoMeasurementSource,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sokoBotDraftEmailInputSchema,
  sokoBotListIntegrationToolsInputSchema,
  sokoBotReadEmailInputSchema,
  sokoBotReadsXDms,
  sokoBotRunIntegrationToolInputSchema,
  sokoBotSaveEmailAttachmentInputSchema,
  sokoBotSearchInboxInputSchema,
  sokoBotSendEmailDraftInputSchema,
  sokoBotUpdateEmailsInputSchema,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { readSokoBotSource } from "@/lib/soko-bot/source-query";
import { X_INBOX_PROVIDER } from "@/lib/soko-bot/x-inbox";
import { testCopySourceBotId } from "@/services/cmo-test-copy.service";
import {
  adToolkitRefusal,
  integrationToolSearchResult,
  listIntegrationTools,
  readIntegrationTool,
  runIntegrationTool,
} from "@/services/composio-integration-tools.service";
import { listSokoBotIntegrationsForBot } from "@/services/soko-bot-integration-list.service";
import {
  activeIntegrationsForBot,
  fetchInboxMessage,
  fetchInboxPage,
} from "@/services/soko-bot-integrations.service";
import { listMcpServersForBot } from "@/services/soko-bot-mcp.service";
import { readXDm, searchXDms } from "@/services/soko-bot-x-dms.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { ownerDirectReader } from "./acting-scope";
import { listCalendarEvents } from "./calendar";
import { type RuntimeOperations } from "./operations";

/**
 * The bot's connected account for a generic toolkit. A CMO test copy has no
 * measurement account of its own: it reads its source's (ADR 0073), and only
 * with tools Composio marks read-only.
 */
/**
 * Whether this turn may see the owner's private X direct messages: a personal bot
 * on its owner's own turn or rhythm, answering in a private chat. Never a
 * teammate, another bot, a shared bot or a shared room.
 */
/** Composio's X tools that send, start or delete a direct message. */
const X_DM_WRITE =
  /^TWITTER_(SEND_A_NEW_MESSAGE_TO_A_(DM_CONVERSATION|USER)|CREATE_A_NEW_DM_CONVERSATION|DELETE_DM)$/;

/** Composio's X tools that read direct messages. */
const X_DM_READ = /^TWITTER_\w*DM_\w*EVENTS/;

/**
 * X direct messages are the owner's alone: read for them only, and sent only
 * when they ask for that message in their own chat.
 */
async function xDmToolRefusal(
  authorized: AuthorizedSokoBotRuntime,
  tool: string,
): Promise<string | null> {
  const slug = tool.trim().toUpperCase();
  if (X_DM_WRITE.test(slug))
    return (await ownerAskedThisTurn(authorized))
      ? null
      : "X direct messages are sent only when the owner asks for that message in their own chat. Offer a draft reply instead.";
  if (X_DM_READ.test(slug))
    return (await ownerPrivateTurn(authorized))
      ? null
      : "X direct messages are private to the owner and read only in their own chat.";
  return null;
}

/** The owner typed this turn's request in their private chat. */
async function ownerAskedThisTurn(
  authorized: AuthorizedSokoBotRuntime,
): Promise<boolean> {
  return (
    authorized.askedByKind === "OWNER" &&
    authorized.turn.source === "CHAT" &&
    (await ownerPrivateTurn(authorized))
  );
}

async function ownerPrivateTurn(
  authorized: AuthorizedSokoBotRuntime,
): Promise<boolean> {
  if (!ownerDirectReader(authorized)) return false;
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: {
      sokoBot: { select: { userId: true } },
      destinationRoomId: true,
    },
  });
  if (
    !turn ||
    turn.sokoBot.userId === null ||
    turn.sokoBot.userId !== authorized.turn.actingUserId
  )
    return false;
  if (!turn.destinationRoomId) return true;
  const room = await prisma.chatRoom.findUnique({
    where: { id: turn.destinationRoomId },
    select: { kind: true },
  });
  return room?.kind === "direct";
}

async function genericIntegration(sokoBotId: string, provider: string) {
  const sourceBotId = isCmoMeasurementSource(provider)
    ? await testCopySourceBotId(sokoBotId)
    : null;
  const [integration] = await activeIntegrationsForBot(
    sourceBotId ?? sokoBotId,
    "generic",
    provider,
  );
  return { integration, readOnly: sourceBotId !== null };
}

/** What to do instead: the bot asked for an app nobody connected. */
function notConnected(provider: string): string {
  return `No account for ${provider} is connected, so nothing can be read or run there. Do not try it again in this turn: call list_integrations to see what is connected (mailboxes use search_inbox), and if the work needs ${provider}, tell the owner to connect it in your settings.`;
}

export async function dispatchIntegrationsTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_integrations": {
      const [result, mcpServers] = await Promise.all([
        listSokoBotIntegrationsForBot(authorized.turn.sokoBotId),
        listMcpServersForBot(authorized.turn.sokoBotId),
      ]);
      // A bot's own ad connection is unusable: ads go through the Project's
      // ad account. The owner still sees it in Settings to disconnect it.
      return [
        ...result.integrations.filter(
          (i) => i.status !== "DISCONNECTED" && !adToolkitRefusal(i.provider),
        ),
        // Where the bot looks first for "is X connected", so its MCP servers
        // are named here too (ADR 0074).
        ...mcpServers,
      ];
    }

    case "find_integrations":
      return runtime.findIntegrations(
        authorized,
        SOKO_BOT_TOOL_INPUT_SCHEMAS.find_integrations.parse(input.input).query,
      );

    case "search_inbox": {
      const parsed = sokoBotSearchInboxInputSchema.parse(input.input);
      const integrations = await activeIntegrationsForBot(
        authorized.turn.sokoBotId,
        "email",
        parsed.provider,
      );
      const limit = parsed.limit ?? 20;
      // A token belongs to one mailbox; across several, a merged page cut
      // to the limit would skip mail the token has already moved past.
      if (parsed.pageToken && integrations.length !== 1)
        throw new SokoBotRuntimeValidationError(
          "pageToken needs the provider of the page it came from",
        );
      let nextPageToken: string | null = null;
      const readsX =
        (!parsed.provider || parsed.provider === X_INBOX_PROVIDER) &&
        !parsed.pageToken &&
        sokoBotReadsXDms(getSokoBotVersion(authorized.turn.versionId).skills) &&
        (await ownerPrivateTurn(authorized));
      const result = await readSokoBotSource({
        source: "MAIL",
        filters: {
          query: parsed.query ?? "",
          since: parsed.since ?? "",
          unreadOnly: String(parsed.unreadOnly ?? false),
        },
        queries: [
          ...integrations.map((integration) => async () => {
            const page = await fetchInboxPage(integration, {
              query: parsed.query,
              since: parsed.since ? new Date(parsed.since) : undefined,
              unreadOnly: parsed.unreadOnly,
              limit,
              pageToken: parsed.pageToken,
            });
            if (integrations.length === 1) nextPageToken = page.nextPageToken;
            return page.messages;
          }),
          ...(readsX
            ? [
                () =>
                  searchXDms(authorized.turn.sokoBotId, {
                    query: parsed.query,
                    since: parsed.since ? new Date(parsed.since) : undefined,
                    limit,
                  }),
              ]
            : []),
        ],
      });
      return {
        coverage: {
          ...result.coverage,
          includedCount: Math.min(result.rows.length, limit),
          omittedCount: Math.max(0, result.rows.length - limit),
        },
        failedSources: result.failedSources,
        note: result.note,
        messages: result.rows
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
          .slice(0, limit),
        nextPageToken,
      };
    }

    case "read_email": {
      const parsed = sokoBotReadEmailInputSchema.parse(input.input);
      if (parsed.provider === X_INBOX_PROVIDER) {
        const message =
          sokoBotReadsXDms(
            getSokoBotVersion(authorized.turn.versionId).skills,
          ) && (await ownerPrivateTurn(authorized))
            ? await readXDm(authorized.turn.sokoBotId, parsed.messageId)
            : null;
        if (!message)
          throw new SokoBotRuntimeValidationError(
            "No X direct message with that id from the last day for the owner",
          );
        return message;
      }
      const [integration] = await activeIntegrationsForBot(
        authorized.turn.sokoBotId,
        "email",
        parsed.provider,
      );
      if (!integration) {
        throw new SokoBotRuntimeValidationError(
          `No connected mailbox for provider ${parsed.provider}`,
        );
      }
      return fetchInboxMessage(integration, parsed.messageId);
    }

    case "update_emails":
      return runtime.updateEmails(
        authorized,
        sokoBotUpdateEmailsInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "draft_email":
      return runtime.draftEmail(
        authorized,
        sokoBotDraftEmailInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "save_email_attachment":
      return runtime.saveEmailAttachment(
        authorized,
        sokoBotSaveEmailAttachmentInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "send_email_draft":
      return runtime.sendEmailDraft(
        authorized,
        sokoBotSendEmailDraftInputSchema.parse(input.input),
        input.toolCallId,
      );

    case "list_integration_tools": {
      const parsed = sokoBotListIntegrationToolsInputSchema.parse(input.input);
      const refusal = adToolkitRefusal(parsed.provider);
      if (refusal) throw new SokoBotRuntimeValidationError(refusal);
      const { integration } = await genericIntegration(
        authorized.turn.sokoBotId,
        parsed.provider.toLowerCase(),
      );
      if (!integration) {
        throw new SokoBotRuntimeValidationError(notConnected(parsed.provider));
      }
      return integrationToolSearchResult(
        await listIntegrationTools(integration, {
          query: parsed.query,
          limit: parsed.limit ?? 20,
        }),
        parsed.query,
      );
    }

    case "read_integration_tool":

    case "run_integration_tool": {
      const parsed = sokoBotRunIntegrationToolInputSchema.parse(input.input);
      // Nothing was sent: a refused-unsent receipt, so a retry stays allowed.
      const refusal = adToolkitRefusal(parsed.provider, parsed.tool);
      if (refusal) throw new SokoBotRefusedUnsentError(refusal);
      const xDmRefusal = await xDmToolRefusal(authorized, parsed.tool);
      if (xDmRefusal) throw new SokoBotRefusedUnsentError(xDmRefusal);
      const { integration, readOnly } = await genericIntegration(
        authorized.turn.sokoBotId,
        parsed.provider.toLowerCase(),
      );
      if (!integration) {
        throw new SokoBotRuntimeValidationError(notConnected(parsed.provider));
      }
      return (
        input.capability === "read_integration_tool" || readOnly
          ? readIntegrationTool
          : runIntegrationTool
      )(integration, parsed.tool, parsed.arguments ?? {});
    }

    case "list_calendar_events":
      return listCalendarEvents(authorized, input.input);
  }
}

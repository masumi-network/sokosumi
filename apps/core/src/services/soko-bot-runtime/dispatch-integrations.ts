import {
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  sokoBotDraftEmailInputSchema,
  sokoBotListCalendarEventsInputSchema,
  sokoBotListIntegrationToolsInputSchema,
  sokoBotReadEmailInputSchema,
  sokoBotRunIntegrationToolInputSchema,
  sokoBotSaveEmailAttachmentInputSchema,
  sokoBotSearchInboxInputSchema,
  sokoBotSendEmailDraftInputSchema,
  sokoBotUpdateEmailsInputSchema,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { readSokoBotSource } from "@/lib/soko-bot/source-query";
import {
  adToolkitRefusal,
  listIntegrationTools,
  readIntegrationTool,
  runIntegrationTool,
} from "@/services/composio-integration-tools.service";
import { listSokoBotIntegrationsForBot } from "@/services/soko-bot-integration-list.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
  fetchInboxMessage,
  fetchInboxPage,
} from "@/services/soko-bot-integrations.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

export async function dispatchIntegrationsTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_integrations":
      // A bot's own ad connection is unusable: ads go through the Project's
      // ad account. The owner still sees it in Settings to disconnect it.
      return listSokoBotIntegrationsForBot(authorized.turn.sokoBotId).then(
        (result) =>
          result.integrations.filter(
            (i) => i.status !== "DISCONNECTED" && !adToolkitRefusal(i.provider),
          ),
      );

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
      const result = await readSokoBotSource({
        source: "MAIL",
        filters: {
          query: parsed.query ?? "",
          since: parsed.since ?? "",
          unreadOnly: String(parsed.unreadOnly ?? false),
        },
        queries: integrations.map((integration) => async () => {
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
      const [integration] = await activeIntegrationsForBot(
        authorized.turn.sokoBotId,
        "generic",
        parsed.provider.toLowerCase(),
      );
      if (!integration) {
        throw new SokoBotRuntimeValidationError(
          `No connected account for provider ${parsed.provider} (mailboxes use search_inbox)`,
        );
      }
      return {
        tools: await listIntegrationTools(integration, {
          query: parsed.query,
          limit: parsed.limit ?? 20,
        }),
      };
    }

    case "read_integration_tool":

    case "run_integration_tool": {
      const parsed = sokoBotRunIntegrationToolInputSchema.parse(input.input);
      // Nothing was sent: a refused-unsent receipt, so a retry stays allowed.
      const refusal = adToolkitRefusal(parsed.provider, parsed.tool);
      if (refusal) throw new SokoBotRefusedUnsentError(refusal);
      const [integration] = await activeIntegrationsForBot(
        authorized.turn.sokoBotId,
        "generic",
        parsed.provider.toLowerCase(),
      );
      if (!integration) {
        throw new SokoBotRuntimeValidationError(
          `No connected account for provider ${parsed.provider}`,
        );
      }
      return (
        input.capability === "read_integration_tool"
          ? readIntegrationTool
          : runIntegrationTool
      )(integration, parsed.tool, parsed.arguments ?? {});
    }

    case "list_calendar_events": {
      const parsed = sokoBotListCalendarEventsInputSchema.parse(input.input);
      const from = parsed.from ? new Date(parsed.from) : new Date();
      const to = parsed.to
        ? new Date(parsed.to)
        : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1_000);
      const integrations = await activeIntegrationsForBot(
        authorized.turn.sokoBotId,
        "calendar",
        parsed.provider,
      );
      if (to <= from)
        throw new SokoBotRuntimeValidationError(
          "Calendar window must end after it starts",
        );
      const limit = parsed.limit ?? 50;
      const result = await readSokoBotSource({
        source: "CALENDAR",
        filters: { from: from.toISOString(), to: to.toISOString() },
        queries: integrations.map(
          (integration) => () =>
            fetchCalendarEvents(integration, { from, to, limit }),
        ),
      });
      const tzRow = await prisma.sokoBot.findUnique({
        where: { id: authorized.turn.sokoBotId },
        select: { ingestTimezone: true },
      });
      const timeZone = tzRow?.ingestTimezone ?? "UTC";
      const local = (iso: string | null) =>
        iso
          ? new Intl.DateTimeFormat("en-GB", {
              timeZone,
              weekday: "short",
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(iso))
          : null;
      return {
        timeZone,
        coverage: {
          ...result.coverage,
          includedCount: Math.min(result.rows.length, limit),
          omittedCount: Math.max(0, result.rows.length - limit),
        },
        failedSources: result.failedSources,
        note: result.note,
        events: result.rows
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, limit)
          .map((event) => ({
            ...event,
            startsAtLocal: local(event.startsAt),
            endsAtLocal: local(event.endsAt),
          })),
      };
    }
  }
}

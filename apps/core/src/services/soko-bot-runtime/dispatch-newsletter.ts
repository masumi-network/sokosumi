import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { HTTPException } from "hono/http-exception";
import { loadSokoBotTurnAuthContext } from "@/helpers/soko-bot-turn-auth-context";
import { serializableTransaction } from "@/lib/db/transaction";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import {
  newsletterSettingsNeedOwner,
  resolveNewsletterContentImages,
  runNewsletterReadTool,
  runNewsletterSubscriberTool,
  runNewsletterWriteTool,
  updateNewsletterSettings,
} from "@/lib/soko-bot/newsletter-tools";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import { newsletterIssueSchema } from "@/schemas/newsletter.schema";
import { generateNewsletterDraft } from "@/services/newsletter-draft.service";
import {
  createNewsletterIssue,
  sokoBotNewsletterTaskContext,
} from "@/services/newsletter-issues.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { type RuntimeOperations } from "./operations";

export async function dispatchNewsletterTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "newsletter_draft_issue": {
      const { projectId, ...params } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.newsletter_draft_issue.parse(input.input);
      const scope = await runtime.requireNewsletterScope(
        authorized,
        input.capability,
        projectId,
      );
      const draft = await generateNewsletterDraft(scope, params);
      return serializableTransaction(async (tx) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          input.capability,
          { projectIds: [projectId] },
        );
        const issue = await createNewsletterIssue(
          { projectId, workspaceId: scope.workspaceId },
          draft,
          { client: tx, creatorSokoBotId: authorized.turn.sokoBotId },
        );
        // Keep the review target intact even when the content exceeds the receipt size limit.
        const result = newsletterIssueSchema
          .pick({
            id: true,
            projectId: true,
            subject: true,
            status: true,
            revision: true,
          })
          .parse(issue);
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId: input.toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: issue.id,
          observedVersion: String(issue.revision),
          result: persistedToolResult(result),
        });
        return result;
      }, "Newsletter draft changed concurrently");
    }

    case "get_newsletter":

    case "list_newsletter_issues":

    case "get_newsletter_issue":

    case "get_newsletter_analytics":

    case "list_newsletter_subscribers":

    case "preview_newsletter_issue":

    case "preview_newsletter_signup_form": {
      const parsed = SOKO_BOT_TOOL_INPUT_SCHEMAS[input.capability].parse(
        input.input,
      );
      const { projectId } = parsed;
      const scope = await runtime.requireNewsletterScope(
        authorized,
        input.capability,
        projectId,
      );
      const resolved =
        input.capability === "preview_newsletter_issue"
          ? {
              ...parsed,
              content: await resolveNewsletterContentImages(
                SOKO_BOT_TOOL_INPUT_SCHEMAS.preview_newsletter_issue.parse(
                  parsed,
                ).content,
                (fileId) => runtime.newsletterImageFileUrl(authorized, fileId),
              ),
            }
          : parsed;
      return runNewsletterReadTool(input.capability, resolved, {
        projectId,
        workspaceId: scope.workspaceId,
      });
    }

    case "create_newsletter_issue":

    case "update_newsletter_issue":

    case "delete_newsletter_issue":

    case "submit_newsletter_issue": {
      const { capability } = input;
      const parsed = SOKO_BOT_TOOL_INPUT_SCHEMAS[capability].parse(input.input);
      const { projectId } = parsed;
      const scope = await runtime.requireNewsletterScope(
        authorized,
        capability,
        projectId,
      );
      // Deleting loses the issue for good: only on the owner's word.
      const { isOwnerDirected } = await import("@/lib/soko-bot/turn-loop");
      if (
        capability === "delete_newsletter_issue" &&
        !(await isOwnerDirected(authorized.turn.id))
      )
        throw new SokoBotRuntimeValidationError(
          "Newsletter issues are only deleted when the owner asks in chat; ask them first",
        );
      const resolved =
        "content" in parsed
          ? {
              ...parsed,
              content: await resolveNewsletterContentImages(
                parsed.content,
                (fileId) => runtime.newsletterImageFileUrl(authorized, fileId),
              ),
            }
          : parsed;
      try {
        return await serializableTransaction(async (tx) => {
          await runtime.requireMutationAuthority(
            tx,
            authorized,
            false,
            capability,
            { projectIds: [projectId] },
          );
          const result = await runNewsletterWriteTool(
            capability,
            resolved,
            { projectId, workspaceId: scope.workspaceId },
            {
              client: tx,
              creatorSokoBotId: authorized.turn.sokoBotId,
              // As when the bot submits over REST with its own key.
              taskContext: async () => {
                const auth = await loadSokoBotTurnAuthContext(
                  authorized.turn,
                  tx,
                );
                if (!auth)
                  throw new SokoBotRuntimeAuthorizationError(
                    "Soko Bot is unavailable",
                  );
                return sokoBotNewsletterTaskContext(auth);
              },
            },
          );
          await commitActionReceipt(tx, {
            turnId: authorized.turn.id,
            toolCallId: input.toolCallId,
            actorBotId: authorized.turn.sokoBotId,
            targetId: result.id,
            observedVersion: String(result.revision),
            result: persistedToolResult(result),
          });
          return result;
        }, "Newsletter issue changed concurrently");
      } catch (error) {
        // Stale revision or a status that no longer allows the change.
        if (error instanceof HTTPException && error.status === 409)
          throw new SokoBotRuntimeConflictError(
            `${error.message}. Read the issue again with get_newsletter_issue, keep any human edits, and retry with its current revision only if the change still applies.`,
          );
        throw error;
      }
    }

    case "update_newsletter_settings": {
      const { projectId } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.update_newsletter_settings.parse(
          input.input,
        );
      const scope = await runtime.requireNewsletterScope(
        authorized,
        input.capability,
        projectId,
      );
      // Sender, reply-to and the welcome email reach subscribers' inboxes.
      const { isOwnerDirected } = await import("@/lib/soko-bot/turn-loop");
      if (
        newsletterSettingsNeedOwner(input.input) &&
        !(await isOwnerDirected(authorized.turn.id))
      )
        throw new SokoBotRuntimeValidationError(
          "Newsletter sender name, reply-to and welcome email change only when the owner asks in chat; ask them first",
        );
      try {
        return await serializableTransaction(async (tx) => {
          await runtime.requireMutationAuthority(
            tx,
            authorized,
            false,
            input.capability,
            { projectIds: [projectId] },
          );
          const result = await updateNewsletterSettings(
            input.input,
            { projectId, workspaceId: scope.workspaceId },
            tx,
          );
          await commitActionReceipt(tx, {
            turnId: authorized.turn.id,
            toolCallId: input.toolCallId,
            actorBotId: authorized.turn.sokoBotId,
            targetId: result.id,
            observedVersion: result.updatedAt,
            result: persistedToolResult(result),
          });
          return result;
        }, "Newsletter settings changed concurrently");
      } catch (error) {
        if (error instanceof HTTPException && error.status === 409)
          throw new SokoBotRuntimeConflictError(
            `${error.message}. Read the settings again with get_newsletter and retry only if the change still applies.`,
          );
        throw error;
      }
    }

    case "add_newsletter_subscriber":

    case "import_newsletter_subscribers":

    case "add_newsletter_subscribers_from_contacts":

    case "update_newsletter_subscriber":

    case "remove_newsletter_subscriber": {
      const { capability } = input;
      const { projectId } = SOKO_BOT_TOOL_INPUT_SCHEMAS[capability].parse(
        input.input,
      );
      const scope = await runtime.requireNewsletterScope(
        authorized,
        capability,
        projectId,
      );
      await runtime.requireOwnerSubscriberWord(
        authorized,
        capability,
        input.input,
      );
      const { sokoBotId } = authorized.turn;
      try {
        return await runNewsletterSubscriberTool(
          capability,
          input.input,
          { projectId, workspaceId: scope.workspaceId },
          {
            adder: {
              actor: {
                workspaceId: scope.workspaceId,
                userId: actingMemberOf(authorized),
                sokoBotId,
              },
              requester: { sokoBotId },
            },
            hooks: {
              authorize: (tx) =>
                runtime.requireMutationAuthority(
                  tx,
                  authorized,
                  false,
                  capability,
                  { projectIds: [projectId] },
                ),
              commit: (tx, targetId, result) =>
                commitActionReceipt(tx, {
                  turnId: authorized.turn.id,
                  toolCallId: input.toolCallId,
                  actorBotId: sokoBotId,
                  targetId,
                  result: persistedToolResult(result),
                }),
            },
            readCsv: (fileId) => runtime.readCsvFile(authorized, fileId),
          },
        );
      } catch (error) {
        // The Subscribers page's refusals: the model reads why.
        if (error instanceof HTTPException && error.status < 500)
          throw error.status === 409
            ? new SokoBotRuntimeConflictError(error.message)
            : new SokoBotRuntimeValidationError(error.message);
        throw error;
      }
    }
  }
}

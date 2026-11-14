import { type Prisma } from "@sokosumi/database";
import {
  getSokoBotVersion,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "@sokosumi/soko-bot";
import {
  isXLongPostSubscription,
  socialPostFirstCommentLimit,
  socialPostTextLimit,
  socialProvidersForWorkspace,
} from "@sokosumi/utils";
import { z } from "zod";
import { socialProviderWorkspaceForProject } from "@/config/social-providers";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { SOCIAL_POST_WRITING_GUIDES } from "@/lib/social-post-writing";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";
import { projectPostingInstructionsSchema } from "@/schemas/project.schema";
import { projectSocialConnectionSchema } from "@/schemas/project-social-connection.schema";
import { socialPostSchema } from "@/schemas/social-post.schema";
import { cmoExecutionRefusal } from "@/services/cmo-billing.service";
import {
  listProjectSocialConnections,
  requireScopedProject,
} from "@/services/project-social-connections.service";
import {
  listSocialAccountStatistics,
  refreshSocialAccountStatistics,
} from "@/services/social-account-statistics.service";
import { publishSocialPostNow } from "@/services/social-post-publisher.service";
import {
  listSocialPostStatistics,
  refreshSocialPostStatistics,
} from "@/services/social-post-statistics.service";
import {
  cancelSocialPost,
  createSocialPost,
  getSocialPost,
  listSocialPosts,
  prepareSocialPostMutationMedia,
  requireMonthPostPicture,
  scheduleSocialPost,
  updateSocialPost,
} from "@/services/social-posts.service";
import { resolveProjectXSubscriptionTypes } from "@/services/x-subscription-tier.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import {
  actingMemberOf,
  actsForOwner,
  requireSokoBotWorkspaceAccess,
} from "./acting-scope";
import { type RuntimeOperations } from "./operations";

/** Social tools use the turn's owner/workspace, never actor fields from model input. */
export async function requireSocialAccess(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  tx: Prisma.TransactionClient = prisma,
  ownerMessage = "Project social tools are only available for the owner",
) {
  if (authorized.turn.chainDepth > 0 || !actsForOwner(authorized)) {
    throw new SokoBotRuntimeAuthorizationError(ownerMessage);
  }
  const userId = actingMemberOf(authorized);
  const owner = await tx.user.findUnique({
    where: { id: userId },
    select: BEARER_USER_SELECT,
  });
  if (!isActiveUser(owner)) {
    throw new SokoBotRuntimeAuthorizationError(
      "Social account owner is no longer active",
    );
  }
  const workspace = await requireSokoBotWorkspaceAccess(
    tx,
    userId,
    authorized.turn.workspaceId,
  );
  await requireAssignedOrganizationSeat(userId, workspace.organizationId, tx);

  return workspace;
}

/**
 * CMO bots schedule and publish only once the owner approved the strategy
 * and the workspace has an active CMO plan (`cmoMayExecute`). No-op for
 * every other bot.
 */
export async function requireCmoExecution(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
) {
  const refusal = await cmoExecutionRefusal({
    sokoBotId: authorized.turn.sokoBotId,
    versionId: authorized.turn.versionId,
  });
  if (refusal) throw new SokoBotRuntimeValidationError(refusal);
}

export async function executeSocialTool(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  const { workspaceId } = authorized.turn;
  const userId = actingMemberOf(authorized);
  if (
    getSokoBotVersion(authorized.turn.versionId).profile === "cmo" &&
    (input.capability === "publish_social_post" ||
      input.capability === "schedule_social_post" ||
      (input.capability === "create_social_post" &&
        SOKO_BOT_TOOL_INPUT_SCHEMAS.create_social_post.safeParse(input.input)
          .data?.scheduledAt))
  ) {
    await runtime.requireCmoExecution(authorized);
  }
  switch (input.capability) {
    case "list_project_social_accounts": {
      const params =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.list_project_social_accounts.parse(
          input.input,
        );
      await runtime.requireSocialAccess(authorized);
      const project = await requireScopedProject({ ...params, workspaceId });
      const [accounts, xTiers] = await Promise.all([
        listProjectSocialConnections({ ...params, workspaceId }),
        resolveProjectXSubscriptionTypes(params.projectId),
      ]);
      const enabledProviders = socialProvidersForWorkspace(
        socialProviderWorkspaceForProject(project),
      );
      return {
        enabledProviders,
        // Read before drafting: how a good post reads on each network.
        writingGuides: Object.fromEntries(
          enabledProviders
            .filter((provider) =>
              accounts.some((account) => account.provider === provider),
            )
            .map((provider) => [
              provider,
              SOCIAL_POST_WRITING_GUIDES[provider],
            ]),
        ),
        // The bot otherwise assumes "X allows 280 characters" for every X
        // account, so each account states its own limits.
        accounts: z
          .array(projectSocialConnectionSchema)
          .parse(accounts)
          .map((account) => {
            const subscriptionType = xTiers.has(account.id)
              ? (xTiers.get(account.id) ?? null)
              : account.subscriptionType;
            return {
              ...account,
              subscriptionType,
              xPremium:
                account.provider === "x" &&
                isXLongPostSubscription(subscriptionType),
              textLimit: socialPostTextLimit(
                account.provider,
                subscriptionType,
              ),
              firstCommentLimit: socialPostFirstCommentLimit(
                account.provider,
                subscriptionType,
              ),
            };
          }),
      };
    }
    case "get_posting_instructions": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.get_posting_instructions.parse(
        input.input,
      );
      await runtime.requireSocialAccess(authorized);
      const project = await prisma.project.findFirst({
        where: { id: params.projectId, workspaceId },
        select: { postingInstructionsMd: true },
      });
      if (!project)
        throw new SokoBotRuntimeValidationError(
          "That Project is not one your owner can open.",
        );
      return projectPostingInstructionsSchema.parse(project);
    }
    case "list_social_posts": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_posts.parse(
        input.input,
      );
      await runtime.requireSocialAccess(authorized);
      const result = await listSocialPosts({ ...params, workspaceId });
      return {
        ...result,
        posts: result.posts.map((post) => socialPostSchema.parse(post)),
      };
    }
    case "list_social_post_statistics": {
      const params =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_post_statistics.parse(
          input.input,
        );
      await runtime.requireSocialAccess(authorized);
      const result = await listSocialPostStatistics({
        ...params,
        workspaceId,
        publishedFrom: params.publishedFrom
          ? new Date(params.publishedFrom)
          : undefined,
        publishedUntil: params.publishedUntil
          ? new Date(params.publishedUntil)
          : undefined,
      });
      return {
        ...result,
        posts: result.posts.map((post) => socialPostSchema.parse(post)),
      };
    }
    case "refresh_social_post_statistics": {
      const params =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_post_statistics.parse(
          input.input,
        );
      await runtime.requireSocialAccess(authorized);
      return socialPostSchema.parse(
        await refreshSocialPostStatistics({ ...params, workspaceId, userId }),
      );
    }
    case "list_social_account_statistics": {
      const params =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_account_statistics.parse(
          input.input,
        );
      await runtime.requireSocialAccess(authorized);
      return listSocialAccountStatistics({
        ...params,
        workspaceId,
        publishedFrom: params.publishedFrom
          ? new Date(params.publishedFrom)
          : undefined,
        publishedUntil: params.publishedUntil
          ? new Date(params.publishedUntil)
          : undefined,
      });
    }
    case "refresh_social_account_statistics": {
      const params =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.refresh_social_account_statistics.parse(
          input.input,
        );
      await runtime.requireSocialAccess(authorized);
      return refreshSocialAccountStatistics({
        ...params,
        workspaceId,
        userId,
      });
    }
    case "get_social_post": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.get_social_post.parse(
        input.input,
      );
      await runtime.requireSocialAccess(authorized);
      return socialPostSchema.parse(
        await getSocialPost({ ...params, workspaceId }),
      );
    }
    case "publish_social_post": {
      const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.publish_social_post.parse(
        input.input,
      );
      await runtime.requireSocialAccess(authorized);
      // The external-effect reservation fences retries before the provider call.
      // The publisher owns revision checks, claiming, and delivery reconciliation.
      return socialPostSchema.parse(
        await publishSocialPostNow({ ...params, workspaceId, userId }),
      );
    }
    case "create_social_post":
    case "update_social_post":
    case "schedule_social_post":
    case "cancel_social_post": {
      // Resolved before the transaction: it reads the blob store, and a
      // serializable transaction should not wait on the network.
      let { media, threadParts } =
        input.capability === "create_social_post" ||
        input.capability === "update_social_post"
          ? await runtime.resolveSocialPostMedia(
              authorized,
              SOKO_BOT_TOOL_INPUT_SCHEMAS[input.capability].parse(input.input),
            )
          : { media: undefined, threadParts: undefined };
      if (
        input.capability === "create_social_post" ||
        input.capability === "update_social_post" ||
        input.capability === "schedule_social_post"
      ) {
        const params = SOKO_BOT_TOOL_INPUT_SCHEMAS[input.capability].parse(
          input.input,
        );
        const workspace = await runtime.requireSocialAccess(authorized);
        const prepared = await prepareSocialPostMutationMedia({
          ...params,
          workspaceId,
          userId,
          organizationId: workspace.organizationId,
          media,
          threadParts,
        });
        media = prepared.media;
        threadParts = prepared.threadParts;
      }
      return serializableTransaction(async (tx) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          input.capability,
        );
        const workspace = await runtime.requireSocialAccess(authorized, tx);
        const scope = {
          workspaceId,
          userId,
          organizationId: workspace.organizationId,
        };
        const post = await (async () => {
          switch (input.capability) {
            case "create_social_post": {
              const params =
                SOKO_BOT_TOOL_INPUT_SCHEMAS.create_social_post.parse(
                  input.input,
                );
              return createSocialPost(
                {
                  ...params,
                  ...scope,
                  media,
                  threadParts,
                  sokoBotId: authorized.turn.sokoBotId,
                  scheduledAt: params.scheduledAt
                    ? new Date(params.scheduledAt)
                    : undefined,
                },
                tx,
              );
            }
            case "update_social_post": {
              const params =
                SOKO_BOT_TOOL_INPUT_SCHEMAS.update_social_post.parse(
                  input.input,
                );
              return updateSocialPost(
                {
                  ...params,
                  ...scope,
                  media,
                  threadParts,
                  sokoBotId: authorized.turn.sokoBotId,
                },
                tx,
              );
            }
            case "schedule_social_post": {
              const params =
                SOKO_BOT_TOOL_INPUT_SCHEMAS.schedule_social_post.parse(
                  input.input,
                );
              await requireMonthPostPicture(tx, {
                postId: params.postId,
                workspaceId,
              });
              return scheduleSocialPost(
                {
                  ...params,
                  ...scope,
                  media,
                  scheduledAt: new Date(params.scheduledAt),
                },
                tx,
              );
            }
            case "cancel_social_post": {
              const params =
                SOKO_BOT_TOOL_INPUT_SCHEMAS.cancel_social_post.parse(
                  input.input,
                );
              return cancelSocialPost({ ...params, ...scope }, tx);
            }
            default:
              throw new SokoBotRuntimeValidationError(
                "Unsupported social mutation",
              );
          }
        })();
        const result = socialPostSchema.parse(post);
        await commitActionReceipt(tx, {
          turnId: authorized.turn.id,
          toolCallId: input.toolCallId,
          actorBotId: authorized.turn.sokoBotId,
          targetId: post.id,
          observedVersion: String(post.revision),
          result: persistedToolResult(result),
        });
        return result;
      }, "Social post changed concurrently");
    }
    default:
      throw new SokoBotRuntimeValidationError("Unsupported social tool");
  }
}

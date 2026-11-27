import { type Prisma } from "@sokosumi/database";
import {
  getSokoBotVersion,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import {
  isXLongPostSubscription,
  socialPostFirstCommentLimit,
  socialPostTextLimit,
  socialProvidersForWorkspace,
} from "@sokosumi/utils";
import { z } from "zod";
import { socialProviderWorkspaceForProject } from "@/config/social-providers";
import { badRequest } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { EMBEDDING_MODEL } from "@/lib/embeddings";
import { SOCIAL_POST_WRITING_GUIDES } from "@/lib/social-post-writing";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { SOKO_BOT_JEV_MODEL } from "@/lib/soko-bot/jev";
import {
  evaluateSocialWriteAuthority,
  isSocialWriteCapability,
  resolveSocialWriteOrigin,
  resolveTurnOwnerAuthority,
  TAINTED_SOCIAL_UPDATE_DETAIL,
} from "@/lib/soko-bot/owner-authority";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";
import { projectPostingInstructionsSchema } from "@/schemas/project.schema";
import { projectSocialConnectionSchema } from "@/schemas/project-social-connection.schema";
import { socialPostSchema } from "@/schemas/social-post.schema";
import { cmoExecutionRefusal } from "@/services/cmo-billing.service";
import { cmoMakesVariedMonth } from "@/services/cmo-media-maker.service";
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
  botSocialPostUpdateProblems,
  cancelSocialPost,
  createSocialPost,
  getSocialPost,
  linkedInOpeningProblem,
  listSocialPosts,
  MonthPostsChangedError,
  monthSiblingsStamp,
  ownMessageProblem,
  prepareSocialPostMutationMedia,
  requireMonthPostPicture,
  scheduleSocialPost,
  updateSocialPost,
  withSocialPostBatch,
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
import { chargeCheck } from "./cmo";
import { type RuntimeOperations } from "./operations";
import {
  claimAccountQuestion,
  requireChosenSocialDestination,
} from "./social-destination";

/**
 * Every write locks the turn's row (`requireMutationAuthority`), so a model's
 * parallel post edits queue there, and Prisma's 5-second default counts the
 * wait: a median of 14 edits at once in one turn expired 124 of them in a week.
 */
const SOCIAL_WRITE_TIMING = { maxWait: 10_000, timeout: 30_000 };

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

/** What the batch reports of a saved post, also from a replayed call's stored result. */
const savedPostSchema = z.object({
  id: z.string(),
  revision: z.number(),
  status: z.string(),
});

/** Inside the tool's 115 seconds (`sokoBotToolCallTimeoutMs`), with room to answer. */
const BATCH_BUDGET_MS = 100_000;

/**
 * Only unapproved drafts may change on a turn that read the web or ran a
 * command; approved/scheduled posts stay locked until the owner asks in a
 * clean turn.
 */
const TAINTED_EDITABLE_POST_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "NEEDS_APPROVAL",
]);

async function enforceSocialWriteAuthority(
  authorized: AuthorizedSokoBotRuntime,
  capability: SokoBotCapability,
  rawInput: unknown,
  tx?: Prisma.TransactionClient,
): Promise<{ requireUnapprovedDraft: boolean }> {
  const { isTainted, SokoBotTaintedActionError } = await import(
    "@/lib/soko-bot/turn-loop"
  );
  const tainted = await isTainted(authorized.turn.id, tx);
  const resolved = tainted
    ? await resolveTurnOwnerAuthority(authorized.turn.id, tx)
    : null;
  const origin = await resolveSocialWriteOrigin(authorized.turn, tx);
  const decision = evaluateSocialWriteAuthority({
    turn: {
      id: authorized.turn.id,
      sokoBotId: authorized.turn.sokoBotId,
      workspaceId: authorized.turn.workspaceId,
      versionId: authorized.turn.versionId,
      source: origin.source,
      actingUserId: authorized.turn.actingUserId,
      askedByKind: authorized.askedByKind,
      sharedBot: Boolean(authorized.reader?.sharedScope),
    },
    capability,
    rawInput,
    tainted,
    turnAuthority: resolved?.authority ?? null,
    scheduleAuthority: origin.scheduleAuthority,
    watchAuthority: origin.watchAuthority,
  });
  if (!decision.allowed) {
    if (decision.kind === "tainted") {
      throw new SokoBotTaintedActionError(capability, decision.detail);
    }
    throw new SokoBotRuntimeValidationError(decision.detail);
  }
  return { requireUnapprovedDraft: decision.requireUnapprovedDraft };
}

async function requireEditableSocialPostStatus(
  authorized: AuthorizedSokoBotRuntime,
  post: { projectId: string; postId: string },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const { SokoBotTaintedActionError } = await import(
    "@/lib/soko-bot/turn-loop"
  );
  const existing = await getSocialPost(
    { ...post, workspaceId: authorized.turn.workspaceId },
    tx,
  );
  if (!TAINTED_EDITABLE_POST_STATUSES.has(existing.status)) {
    throw new SokoBotTaintedActionError(
      "update_social_post",
      TAINTED_SOCIAL_UPDATE_DETAIL,
    );
  }
}

/** An edit starts only with this long left, and may run at most until the batch's deadline. */
const EDIT_MIN_MS = 15_000;

/** A batch edit matched a post of the same batch whose words may still change. */
class WaitsForBatchPostError extends Error {}

class EditTimedOutError extends Error {
  constructor() {
    super("Out of time for this call: send these posts again.");
  }
}

function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new EditTimedOutError()),
        Math.max(0, deadline - Date.now()),
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * update_social_posts: each post goes through update_social_post as a call
 * of its own (its checks, revision, approval and receipt), one after
 * another. Each edit commits alone, so every check compares with the words
 * posts hold in the database. A match on a batch post that may still get new
 * words waits for the next round; one that has none left is refused. One
 * answer names every refused post and all its problems.
 */
async function updateSocialPosts(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
  deadline = Date.now() + BATCH_BUDGET_MS,
) {
  const { projectId, posts } =
    SOKO_BOT_TOOL_INPUT_SCHEMAS.update_social_posts.parse(input.input);
  if (new Set(posts.map((post) => post.postId)).size !== posts.length)
    throw new SokoBotRuntimeValidationError(
      "Each post can be in one update_social_posts call once.",
    );
  await beforeDeadline(runtime.requireSocialAccess(authorized), deadline);
  const unsaved = new Set(
    posts.flatMap((post) => (post.text === undefined ? [] : [post.postId])),
  );
  const saved: { postId: string; revision: number; status: string }[] = [];
  const refused: { postId: string; problem: string }[] = [];
  const notTried: string[] = [];
  const timedOut: { postId?: string } = {};
  let call = 0;
  // An edit whose month changed under it is checked once more, then refused.
  const changedOnce = new Set<string>();
  await withSocialPostBatch(unsaved, async () => {
    let round = posts;
    while (round.length > 0) {
      const waiting: {
        post: (typeof posts)[number];
        problem: string;
        onBatch: boolean;
      }[] = [];
      for (const post of round) {
        if (timedOut.postId || deadline - Date.now() < EDIT_MIN_MS) {
          notTried.push(post.postId);
          continue;
        }
        try {
          const result = savedPostSchema.parse(
            await beforeDeadline(
              runtime.executeTool({
                ...input,
                capability: "update_social_post",
                toolCallId: `${input.toolCallId}:${(call += 1)}`,
                input: { projectId, ...post },
              }),
              deadline,
            ),
          );
          saved.push({
            postId: result.id,
            revision: result.revision,
            status: result.status,
          });
          unsaved.delete(post.postId);
        } catch (error) {
          if (error instanceof SokoBotRuntimeAuthorizationError) throw error;
          if (error instanceof WaitsForBatchPostError) {
            waiting.push({ post, problem: error.message, onBatch: true });
            continue;
          }
          if (
            error instanceof MonthPostsChangedError &&
            !changedOnce.has(post.postId)
          ) {
            changedOnce.add(post.postId);
            waiting.push({ post, problem: error.message, onBatch: false });
            continue;
          }
          // The edit may still commit: nothing after it is checked against
          // words that could change underneath.
          if (error instanceof EditTimedOutError) {
            timedOut.postId = post.postId;
            continue;
          }
          refused.push({
            postId: post.postId,
            problem: error instanceof Error ? error.message : "Not saved",
          });
          unsaved.delete(post.postId);
        }
      }
      if (timedOut.postId) {
        notTried.push(...waiting.map(({ post }) => post.postId));
        break;
      }
      // No edit settled this round and none is checked again for a change
      // elsewhere: the waiting posts wait on each other.
      if (
        waiting.length === round.length &&
        waiting.every(({ onBatch }) => onBatch)
      ) {
        for (const { post, problem } of waiting)
          refused.push({
            postId: post.postId,
            problem: `${problem} Neither could be saved first: give this post words of its own.`,
          });
        break;
      }
      round = waiting.map(({ post }) => post);
    }
  });
  const next = [
    timedOut.postId &&
      "The stillSaving post's edit ran out of time and may still be saved: read it with get_social_post before changing it again.",
    notTried.length > 0 &&
      "Out of time for this call: send the notTried posts again.",
  ].filter(Boolean);
  return {
    saved,
    refused,
    ...(timedOut.postId && { stillSaving: timedOut.postId }),
    ...(notTried.length > 0 && { notTried }),
    ...(next.length > 0 && { next: next.join(" ") }),
  };
}

export async function executeSocialTool(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
) {
  // From the call's start: slow authority or access reads count toward the
  // batch's 100s budget so the answer still returns inside the 115s timeout.
  const batchDeadline =
    input.capability === "update_social_posts"
      ? Date.now() + BATCH_BUDGET_MS
      : undefined;
  const { workspaceId } = authorized.turn;
  const userId = actingMemberOf(authorized);
  const writeAuthority = isSocialWriteCapability(input.capability)
    ? await (batchDeadline !== undefined
        ? beforeDeadline(
            enforceSocialWriteAuthority(
              authorized,
              input.capability,
              input.input,
            ),
            batchDeadline,
          )
        : enforceSocialWriteAuthority(
            authorized,
            input.capability,
            input.input,
          ))
    : null;
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
    case "update_social_posts":
      return updateSocialPosts(runtime, input, authorized, batchDeadline);
    case "create_social_post":
    case "update_social_post":
    case "schedule_social_post":
    case "cancel_social_post": {
      if (
        input.capability === "update_social_post" &&
        writeAuthority?.requireUnapprovedDraft
      ) {
        const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_social_post.parse(
          input.input,
        );
        await requireEditableSocialPostStatus(authorized, {
          projectId: params.projectId,
          postId: params.postId,
        });
      }
      const { answersQuestionId, answeringTurnId } =
        input.capability === "create_social_post"
          ? await requireChosenSocialDestination(
              authorized,
              SOKO_BOT_TOOL_INPUT_SCHEMAS.create_social_post.parse(input.input),
            )
          : {};
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
      // What the month's other posts were when this edit's words were checked.
      let checkedAgainst: { postId: string; stamp: string } | null = null;
      if (input.capability === "update_social_post") {
        const params = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_social_post.parse(
          input.input,
        );
        // Compared by meaning, which waits on the embedding model, so it
        // runs before the transaction. Deterministic formatting, caveats, and
        // reused-picture checks run alongside them so one refusal names
        // everything to fix at once instead of failing one check per retry.
        if (params.text) {
          const post = {
            postId: params.postId,
            workspaceId,
            text: params.text,
          };
          const stamp = await monthSiblingsStamp(post);
          if (stamp !== null) checkedAgainst = { postId: post.postId, stamp };
          const [deterministicProblems, own, opening] = await Promise.all([
            botSocialPostUpdateProblems({
              projectId: params.projectId,
              postId: params.postId,
              workspaceId,
              revision: params.revision,
              text: params.text,
              firstComment: params.firstComment,
              linkInPost: params.linkInPost,
              socialConnectionId: params.socialConnectionId,
              quotedPostId: params.quotedPostId,
              media,
              threadParts,
            }),
            ownMessageProblem(post),
            cmoMakesVariedMonth(authorized.turn.versionId)
              ? linkedInOpeningProblem(post)
              : null,
          ]);
          await chargeCheck(input, EMBEDDING_MODEL, own.costUsd);
          if (opening)
            await chargeCheck(input, SOKO_BOT_JEV_MODEL, opening.costUsd);
          const checks = [own, ...(opening ? [opening] : [])];
          const problems = [
            ...deterministicProblems,
            ...checks.flatMap((check) =>
              check.problem && !check.waitsForBatch ? [check.problem] : [],
            ),
          ];
          if (problems.length > 0) throw badRequest(problems.join("\n"));
          const wait = checks.find((check) => check.waitsForBatch);
          if (wait?.problem) throw new WaitsForBatchPostError(wait.problem);
        }
      }
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
      return serializableTransaction(
        async (tx) => {
          await runtime.requireMutationAuthority(
            tx,
            authorized,
            false,
            input.capability,
          );
          const txWriteAuthority = await enforceSocialWriteAuthority(
            authorized,
            input.capability,
            input.input,
            tx,
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
                const { accountQuestionId: _checked, ...params } =
                  SOKO_BOT_TOOL_INPUT_SCHEMAS.create_social_post.parse(
                    input.input,
                  );
                const created = await createSocialPost(
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
                // Taken with the saved draft: a failed draft leaves it open.
                if (answersQuestionId)
                  await claimAccountQuestion(
                    tx,
                    answersQuestionId,
                    answeringTurnId ?? authorized.turn.id,
                  );
                return created;
              }
              case "update_social_post": {
                const params =
                  SOKO_BOT_TOOL_INPUT_SCHEMAS.update_social_post.parse(
                    input.input,
                  );
                if (txWriteAuthority.requireUnapprovedDraft) {
                  await requireEditableSocialPostStatus(
                    authorized,
                    { projectId: params.projectId, postId: params.postId },
                    tx,
                  );
                }
                // Serializable: an edit that committed after this one's check
                // is seen here, or this transaction fails and is retried.
                if (
                  checkedAgainst &&
                  (await monthSiblingsStamp(
                    { postId: checkedAgainst.postId, workspaceId },
                    tx,
                  )) !== checkedAgainst.stamp
                )
                  throw new MonthPostsChangedError();
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
        },
        "Social post changed concurrently",
        SOCIAL_WRITE_TIMING,
      );
    }
    default:
      throw new SokoBotRuntimeValidationError("Unsupported social tool");
  }
}

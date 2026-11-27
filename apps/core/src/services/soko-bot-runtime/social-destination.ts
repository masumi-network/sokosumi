import type { Prisma } from "@sokosumi/database";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import {
  type SocialPostProvider,
  socialPostProviderLabel,
} from "@sokosumi/utils";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { openAccountQuestion } from "@/lib/soko-bot/account-question";
import {
  mentionedSocialProviders,
  namedProjectsByTargetResolver,
  namedSocialDestinations,
  namedSocialDestinationsByTargetResolver,
  type SocialDestinationCandidate,
  socialDestinationLabel,
  withoutQuotedCopy,
} from "@/lib/soko-bot/ask-policy-match";
import {
  isTargetResolverEnabled,
  type ResolvedTargetMetadata,
} from "@/lib/soko-bot/target-resolver";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRefusedUnsentError,
} from "../soko-bot-runtime.service";

export { withoutQuotedCopy };

/**
 * An ambiguous destination is asked, not guessed. When the owner asks for a
 * post and more than one connected account could take it, a draft goes
 * through on an account the owner named exactly in their request (its
 * @handle or id, or a Project holding only that account, outside quoted
 * copy), or on an answer to a recorded account question: Core stores the
 * question with its options when it refuses, and a later owner chat turn
 * passes its id with the option the owner picked. What the owner's words
 * mean is the model's call; Core checks only ids.
 */

/** Starts the refusal that records a question. */
export const ASK_WHICH_ACCOUNT = "Several accounts could take this post";
const SHOWN = 10;

type Candidate = SocialDestinationCandidate;

function labels(candidates: readonly Candidate[]): string {
  return candidates.map(socialDestinationLabel).join("; ");
}

function formatProviderList(providers: readonly SocialPostProvider[]): string {
  return providers.map(socialPostProviderLabel).join(" / ");
}

function hasFullCandidateShape(
  row: Partial<Candidate & { provider?: string }>,
): row is Candidate & { provider: string } {
  return Boolean(
    typeof row.id === "string" &&
      row.project &&
      typeof row.project.id === "string" &&
      typeof row.project.name === "string",
  );
}

function refuseWrongProvider(input: {
  mentionedProviders: readonly SocialPostProvider[];
  pickedProvider: string;
  matching: readonly Candidate[];
  scopeProjectName?: string;
  scopeText: string;
}): never {
  const wantedLabel = formatProviderList(input.mentionedProviders);
  const pickedLabel = socialPostProviderLabel(
    input.pickedProvider as SocialPostProvider,
  );
  if (input.matching.length === 0) {
    if (input.scopeProjectName) {
      throw new SokoBotRefusedUnsentError(
        `The owner requested ${wantedLabel}, not ${pickedLabel}. Project "${input.scopeProjectName}" has 0 active ${wantedLabel} accounts connected. Tell the owner no ${wantedLabel} account is connected on the requested project, do not substitute another project, and make no social changes.`,
      );
    }
    throw new SokoBotRefusedUnsentError(
      `The owner requested ${wantedLabel}, not ${pickedLabel}. 0 active ${wantedLabel} accounts are connected ${input.scopeText}. Tell the owner no ${wantedLabel} account is connected and make no social changes.`,
    );
  }
  if (input.matching.length === 1) {
    throw new SokoBotRefusedUnsentError(
      `The owner requested ${wantedLabel}, not ${pickedLabel}. Use ${socialDestinationLabel(input.matching[0]!)} instead.`,
    );
  }
  throw new SokoBotRefusedUnsentError(
    `The owner requested ${wantedLabel}, not ${pickedLabel}. Active ${wantedLabel} accounts in scope: ${labels(input.matching.slice(0, SHOWN))}. Use the matching socialConnectionId or ask the owner once which account to use.`,
  );
}

/** The owner's own chat turn: the only turn that asks the owner anything. */
function ownersOwnChat(authorized: AuthorizedSokoBotRuntime): boolean {
  return (
    authorized.turn.source === "CHAT" &&
    authorized.turn.chainDepth === 0 &&
    authorized.askedByKind === "OWNER"
  );
}

interface OwnerRequest {
  id: string;
  createdAt: Date;
  userMessage: string;
  destinationRoomId: string | null;
}

/** Background runs nest; deeper than this is no owner request to trust. */
const MAX_RUN_DEPTH = 8;

/**
 * The owner's own chat turn the work comes from: this turn, or for a
 * background run the turn that started it (its userMessage is the bot's
 * brief, never the owner's words). Null when no owner turn starts the chain.
 */
async function ownerRequest(
  authorized: AuthorizedSokoBotRuntime,
): Promise<OwnerRequest | null> {
  const select = {
    id: true,
    createdAt: true,
    userMessage: true,
    destinationRoomId: true,
    parentTurnId: true,
    source: true,
  } as const;
  let turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select,
  });
  for (let depth = 0; turn?.parentTurnId; depth += 1) {
    if (depth === MAX_RUN_DEPTH) return null;
    turn = await prisma.sokoBotTurn.findUnique({
      where: { id: turn.parentTurnId },
      select,
    });
  }
  return turn && (turn.source === "CHAT" || turn.source === "ADMIN_RETRY")
    ? turn
    : null;
}

/**
 * Accepts the pick only for a question still open in this chat (delivered
 * on an earlier turn, same room, owner and bot, not used by another turn)
 * whose options hold it. Nothing is claimed here: the draft's own save
 * claims it (claimAccountQuestion), so a draft that fails leaves it open.
 */
async function acceptAnswer(
  authorized: AuthorizedSokoBotRuntime,
  request: OwnerRequest,
  questionId: string,
  pick: string | null | undefined,
): Promise<string> {
  const question = await openAccountQuestion(
    {
      sokoBotId: authorized.turn.sokoBotId,
      requestedByUserId: authorized.turn.requestedByUserId,
      destinationRoomId: request.destinationRoomId,
      turnId: request.id,
      turnCreatedAt: request.createdAt,
    },
    questionId,
  );
  if (!question)
    throw new SokoBotRefusedUnsentError(
      "That account question is not open in this chat: it was not delivered, was asked on this turn, in another room or more than a day ago, or another turn used it. Create the post without accountQuestionId to ask again.",
    );
  if (!pick || !question.options.some((option) => option.id === pick))
    throw new SokoBotRefusedUnsentError(
      `Pass the socialConnectionId of the option the owner picked: one of ${question.options.map((option) => option.id).join(", ")}.`,
    );
  return question.id;
}

/**
 * Inside the transaction that saves the draft: the answering turn takes the
 * question, so a second turn cannot reuse it, and the same turn may draft
 * on several of its options. A draft that rolls back leaves it open.
 */
export async function claimAccountQuestion(
  tx: Prisma.TransactionClient,
  questionId: string,
  turnId: string,
): Promise<void> {
  const claimed = await tx.sokoBotAccountQuestion.updateMany({
    where: {
      id: questionId,
      OR: [{ answeredTurnId: null }, { answeredTurnId: turnId }],
    },
    data: { answeredTurnId: turnId },
  });
  if (claimed.count === 0)
    throw new SokoBotRefusedUnsentError(
      "That account question was just answered on another turn.",
    );
}

export async function requireChosenSocialDestination(
  authorized: AuthorizedSokoBotRuntime,
  params: {
    projectId: string;
    socialConnectionId?: string | null;
    accountQuestionId?: string;
  },
): Promise<{
  answersQuestionId?: string;
  answeringTurnId?: string;
  resolvedSocialConnectionId?: string;
  resolvedTarget?: ResolvedTargetMetadata;
}> {
  const version = getSokoBotVersion(authorized.turn.versionId);
  const targetResolver = isTargetResolverEnabled(authorized.turn.versionId);

  // CMO bots stay strictly confined to their one Project; under targetResolver
  // enforce explicit network constraints before accepting a supplied connection,
  // and auto-resolve omitted socialConnectionId only when 1 active account fits
  // (preserving unconnected drafting when 0 active accounts exist).
  if (version.profile === "cmo") {
    if (!targetResolver) return {};
    const request = ownersOwnChat(authorized)
      ? await ownerRequest(authorized)
      : null;
    const mentioned = request
      ? mentionedSocialProviders(request.userMessage)
      : [];
    if (params.socialConnectionId) {
      if (mentioned.length === 0) return {};
      const pickedCmo = await prisma.projectSocialConnection.findFirst({
        where: { id: params.socialConnectionId, projectId: params.projectId },
        select: { id: true, provider: true, externalHandle: true },
      });
      if (
        pickedCmo &&
        !mentioned.includes(pickedCmo.provider as SocialPostProvider)
      ) {
        const projectConnections =
          await prisma.projectSocialConnection.findMany({
            where: {
              projectId: params.projectId,
              provider: { in: mentioned },
              status: "active",
              project: {
                workspaceId: authorized.turn.workspaceId,
                closedAt: null,
                closingAt: null,
              },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              provider: true,
              externalHandle: true,
              project: { select: { id: true, name: true } },
            },
          });
        const matching = projectConnections.filter(
          (row) =>
            hasFullCandidateShape(row) &&
            mentioned.includes(row.provider as SocialPostProvider),
        );
        refuseWrongProvider({
          mentionedProviders: mentioned,
          pickedProvider: pickedCmo.provider,
          matching,
          scopeText: "on this project",
        });
      }
      return {};
    }
    const projectConnections = await prisma.projectSocialConnection.findMany({
      where: {
        projectId: params.projectId,
        status: "active",
        project: {
          workspaceId: authorized.turn.workspaceId,
          closedAt: null,
          closingAt: null,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        provider: true,
        externalHandle: true,
        project: { select: { id: true, name: true } },
      },
    });
    if (projectConnections.length === 0) return {};
    const pool =
      mentioned.length > 0
        ? projectConnections.filter((c) =>
            mentioned.includes(c.provider as SocialPostProvider),
          )
        : projectConnections;
    if (mentioned.length > 0 && pool.length === 0) {
      const wantedLabel = formatProviderList(mentioned);
      throw new SokoBotRefusedUnsentError(
        `This project has 0 active ${wantedLabel} accounts connected. Tell the owner no ${wantedLabel} account is connected and make no social changes.`,
      );
    }
    if (pool.length === 1) {
      const only = pool[0]!;
      const providerLabel = socialPostProviderLabel(
        only.provider as SocialPostProvider,
      );
      return {
        resolvedSocialConnectionId: only.id,
        resolvedTarget: {
          kind: "account",
          id: only.id,
          label: socialDestinationLabel(only),
          projectId: only.project.id,
          autoResolved: true,
          reason: `Resolved to the only active ${providerLabel} account on Project "${only.project.name}".`,
        },
      };
    }
    if (pool.length >= 2) {
      if (mentioned.length >= 2) {
        const wantedLabel = formatProviderList(mentioned);
        throw new SokoBotRefusedUnsentError(
          `The request names multiple networks (${wantedLabel}). Pass socialConnectionId explicitly for each post from: ${labels(pool.slice(0, SHOWN))}.`,
        );
      }
      if (request) {
        const named = namedSocialDestinationsByTargetResolver(
          request.userMessage,
          pool,
        );
        if (named.length === 1) {
          const only = named[0]!;
          return {
            resolvedSocialConnectionId: only.id,
            resolvedTarget: {
              kind: "account",
              id: only.id,
              label: socialDestinationLabel(only),
              projectId: only.project.id,
              autoResolved: true,
              reason: `Resolved to ${socialDestinationLabel(only)} named in the owner's request.`,
            },
          };
        }
        throw new SokoBotRefusedUnsentError(
          `${ASK_WHICH_ACCOUNT}, and the owner has not named one: ${labels(pool.slice(0, SHOWN))}. Ask the owner once which account to use and make no changes until they answer.`,
        );
      }
    }
    return {};
  }

  if (!ownersOwnChat(authorized)) return {};
  // A background run drafts on what the owner chose in the request that
  // started it, never on an account its own brief names.
  const request = await ownerRequest(authorized);
  const background = request?.id !== authorized.turn.id;
  if (params.accountQuestionId) {
    if (!request)
      throw new SokoBotRefusedUnsentError(
        "No owner chat turn starts this run, so no account question can be answered here.",
      );
    return {
      answersQuestionId: await acceptAnswer(
        authorized,
        request,
        params.accountQuestionId,
        params.socialConnectionId,
      ),
      // The owner's turn takes it, so its runs may draft on the same answer.
      answeringTurnId: request.id,
    };
  }

  const picked = params.socialConnectionId
    ? await prisma.projectSocialConnection.findFirst({
        where: { id: params.socialConnectionId, projectId: params.projectId },
        select: { id: true, provider: true, externalHandle: true },
      })
    : null;

  const explicitlyNamedPicked =
    targetResolver && request && picked
      ? (() => {
          const text = withoutQuotedCopy(request.userMessage);
          if (text.includes(picked.id)) return true;
          const handle = picked.externalHandle?.replace(/^@/, "");
          return Boolean(
            handle &&
              new RegExp(
                `(^|[^\\p{L}\\p{N}_@])@${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
                "iu",
              ).test(text),
          );
        })()
      : false;

  const mentionedProviders =
    targetResolver && request
      ? mentionedSocialProviders(request.userMessage)
      : [];
  const openProjects =
    targetResolver && request
      ? await prisma.project.findMany({
          where: {
            workspaceId: authorized.turn.workspaceId,
            closedAt: null,
            closingAt: null,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 200,
          select: { id: true, name: true },
        })
      : [];
  const namedProjects =
    targetResolver && request && !explicitlyNamedPicked
      ? namedProjectsByTargetResolver(request.userMessage, openProjects)
      : [];
  if (
    targetResolver &&
    picked &&
    mentionedProviders.length > 0 &&
    !mentionedProviders.includes(picked.provider as SocialPostProvider)
  ) {
    const namedScope = namedProjects.length === 1 ? namedProjects[0]! : null;
    const providerCandidates = await prisma.projectSocialConnection.findMany({
      where: {
        provider: { in: mentionedProviders },
        status: "active",
        ...(namedScope ? { projectId: namedScope.id } : {}),
        project: {
          workspaceId: authorized.turn.workspaceId,
          closedAt: null,
          closingAt: null,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        provider: true,
        externalHandle: true,
        project: { select: { id: true, name: true } },
      },
    });
    const matching = providerCandidates.filter(
      (row) =>
        hasFullCandidateShape(row) &&
        mentionedProviders.includes(row.provider as SocialPostProvider) &&
        (!namedScope || row.project.id === namedScope.id),
    );
    refuseWrongProvider({
      mentionedProviders,
      pickedProvider: picked.provider,
      matching,
      scopeProjectName: namedScope?.name,
      scopeText: "in this workspace",
    });
  }

  if (
    targetResolver &&
    namedProjects.length === 1 &&
    params.projectId !== namedProjects[0]!.id
  ) {
    const wanted = namedProjects[0]!;
    throw new SokoBotRefusedUnsentError(
      `The owner named Project "${wanted.name}" (projectId ${wanted.id}). Create the post on that project instead.`,
    );
  }

  let provider: string = picked?.provider ?? "x";
  let preloadedCandidates: Candidate[] | null = null;
  if (targetResolver && !picked && !params.socialConnectionId) {
    if (mentionedProviders.length === 1) {
      provider = mentionedProviders[0]!;
    } else if (mentionedProviders.length >= 2) {
      const wantedLabel = formatProviderList(mentionedProviders);
      const multiActive = await prisma.projectSocialConnection.findMany({
        where: {
          provider: { in: mentionedProviders },
          status: "active",
          ...(namedProjects.length === 1
            ? { projectId: namedProjects[0]!.id }
            : {}),
          project: {
            workspaceId: authorized.turn.workspaceId,
            closedAt: null,
            closingAt: null,
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          provider: true,
          externalHandle: true,
          project: { select: { id: true, name: true } },
        },
      });
      const fullRows = multiActive.filter(hasFullCandidateShape);
      throw new SokoBotRefusedUnsentError(
        `The request names multiple networks (${wantedLabel}). Pass socialConnectionId explicitly for each post${fullRows.length > 0 ? ` from: ${labels(fullRows.slice(0, SHOWN))}` : ""}.`,
      );
    } else {
      const allActive = await prisma.projectSocialConnection.findMany({
        where: {
          status: "active",
          ...(namedProjects.length === 1
            ? { projectId: namedProjects[0]!.id }
            : {}),
          project: {
            workspaceId: authorized.turn.workspaceId,
            closedAt: null,
            closingAt: null,
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          provider: true,
          externalHandle: true,
          project: { select: { id: true, name: true } },
        },
      });
      if (allActive.length === 0) return {};
      const distinctProviders = [
        ...new Set(allActive.map((row) => row.provider).filter(Boolean)),
      ];
      if (distinctProviders.length > 1) {
        const hasFullRows = allActive.every(hasFullCandidateShape);
        if (request && hasFullRows) {
          const namedAcross = namedSocialDestinationsByTargetResolver(
            request.userMessage,
            allActive,
          );
          if (namedAcross.length === 1) {
            const only = namedAcross[0]!;
            if (only.project.id === params.projectId) {
              return {
                resolvedSocialConnectionId: only.id,
                resolvedTarget: {
                  kind: "account",
                  id: only.id,
                  label: socialDestinationLabel(only),
                  projectId: only.project.id,
                  autoResolved: true,
                  reason: `Resolved to ${socialDestinationLabel(only)} named in the owner's request.`,
                },
              };
            }
            throw new SokoBotRefusedUnsentError(
              `The owner named ${labels(namedAcross)}. Create the post there, with that socialConnectionId and projectId.`,
            );
          }
        }
        const providerLabels = distinctProviders
          .map((p) => socialPostProviderLabel(p as SocialPostProvider))
          .join(", ");
        const detail = hasFullRows
          ? `: ${labels(allActive.slice(0, SHOWN))}`
          : ` (${providerLabels})`;
        throw new SokoBotRefusedUnsentError(
          `${ASK_WHICH_ACCOUNT} across multiple networks${detail}, and the owner has not named a network or account. ${!request || background ? "Draft nothing in this run. Say in your report that the owner needs to pick the account; once they answer in chat, the post can be made there." : "Ask the owner once which network and account to use and make no social changes until they answer."}`,
        );
      }
      if (distinctProviders.length === 1 && distinctProviders[0]) {
        provider = distinctProviders[0];
        if (
          namedProjects.length === 0 &&
          allActive.every(hasFullCandidateShape)
        ) {
          preloadedCandidates = allActive;
        }
      }
    }
  }

  const candidates: Candidate[] =
    preloadedCandidates ??
    (await prisma.projectSocialConnection.findMany({
      where: {
        provider,
        status: "active",
        project: {
          workspaceId: authorized.turn.workspaceId,
          closedAt: null,
          closingAt: null,
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        externalHandle: true,
        project: { select: { id: true, name: true } },
      },
    }));

  if (targetResolver && namedProjects.length === 1) {
    const wanted = namedProjects[0]!;
    const onNamedProject = candidates.filter(
      (candidate) => candidate.project.id === wanted.id,
    );
    if (
      onNamedProject.length === 0 &&
      (picked || mentionedProviders.includes(provider as SocialPostProvider))
    ) {
      const label = socialPostProviderLabel(provider as SocialPostProvider);
      throw new SokoBotRefusedUnsentError(
        `Project "${wanted.name}" has 0 active ${label} accounts connected. Tell the owner no ${label} account is connected on the requested project, do not substitute another project, and make no social changes.`,
      );
    }
  }

  if (candidates.length === 0) {
    if (
      targetResolver &&
      !params.socialConnectionId &&
      mentionedProviders.includes(provider as SocialPostProvider)
    ) {
      const label = socialPostProviderLabel(provider as SocialPostProvider);
      throw new SokoBotRefusedUnsentError(
        `0 active ${label} accounts are connected in this workspace. Tell the owner no ${label} account is connected and make no social changes.`,
      );
    }
    return {};
  }

  if (candidates.length === 1) {
    if (!targetResolver) return {};
    const only = candidates[0]!;
    const label = socialPostProviderLabel(provider as SocialPostProvider);
    if (!params.socialConnectionId) {
      if (only.project.id === params.projectId) {
        return {
          resolvedSocialConnectionId: only.id,
          resolvedTarget: {
            kind: "account",
            id: only.id,
            label: socialDestinationLabel(only),
            projectId: only.project.id,
            autoResolved: true,
            reason: `Resolved to the only active ${label} account in the workspace.`,
          },
        };
      }
      throw new SokoBotRefusedUnsentError(
        `The only active ${label} account in this workspace is ${socialDestinationLabel(only)}. Create the post there, with that socialConnectionId and projectId.`,
      );
    }
    if (only.id === params.socialConnectionId) {
      return {
        resolvedTarget: {
          kind: "account",
          id: only.id,
          label: socialDestinationLabel(only),
          projectId: only.project.id,
          autoResolved: false,
          reason: `Only active ${label} account in the workspace.`,
        },
      };
    }
    return {};
  }

  const named = request
    ? targetResolver
      ? namedSocialDestinationsByTargetResolver(request.userMessage, candidates)
      : namedSocialDestinations(request.userMessage, candidates)
    : [];
  if (named.length > 0) {
    if (
      targetResolver &&
      !params.socialConnectionId &&
      named.length === 1 &&
      named[0]!.project.id === params.projectId
    ) {
      const only = named[0]!;
      return {
        resolvedSocialConnectionId: only.id,
        resolvedTarget: {
          kind: "account",
          id: only.id,
          label: socialDestinationLabel(only),
          projectId: only.project.id,
          autoResolved: true,
          reason: `Resolved to ${socialDestinationLabel(only)} named in the owner's request.`,
        },
      };
    }
    if (named.some((candidate) => candidate.id === params.socialConnectionId)) {
      const matched = named.find(
        (candidate) => candidate.id === params.socialConnectionId,
      );
      return targetResolver && matched
        ? {
            resolvedTarget: {
              kind: "account",
              id: matched.id,
              label: socialDestinationLabel(matched),
              projectId: matched.project.id,
              autoResolved: false,
              reason: `Matches ${socialDestinationLabel(matched)} named in the owner's request.`,
            },
          }
        : {};
    }
    throw new SokoBotRefusedUnsentError(
      `The owner named ${labels(named)}. Create the post there, with that socialConnectionId and projectId.`,
    );
  }
  // Only the owner's own turn can ask: a run reports the choice back.
  if (!request || background)
    throw new SokoBotRefusedUnsentError(
      `${ASK_WHICH_ACCOUNT}, and the owner has not chosen one: ${labels(candidates.slice(0, SHOWN))}. Draft nothing in this run. Say in your report that the owner needs to pick the account; once they answer in chat, the post can be made there.`,
    );
  const question = await askOnce(authorized, {
    provider,
    destinationRoomId: request.destinationRoomId,
    optionIds: candidates.slice(0, SHOWN).map((candidate) => candidate.id),
  });
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const options = question.optionIds.flatMap((id) => {
    const option = byId.get(id);
    return option ? [option] : [];
  });
  const more = candidates.length - options.length;
  throw new SokoBotRefusedUnsentError(
    `${ASK_WHICH_ACCOUNT}, and the owner has not named one. Account question ${question.id}, offered accounts: ${labels(options)}${more > 0 ? `; ${more} more are connected (the owner can name one by @handle)` : ""}. Draft nothing on this turn. Core adds the question with these accounts, numbered, under your reply: do not list them yourself, and ask nothing else about the destination. After they answer, create the post with accountQuestionId ${question.id} and the socialConnectionId and projectId of the option they picked.`,
  );
}

/**
 * One question per asking turn and provider (a unique key): a second or
 * concurrent refusal on the turn repeats the stored question and its options.
 */
async function askOnce(
  authorized: AuthorizedSokoBotRuntime,
  input: {
    provider: string;
    destinationRoomId: string | null;
    optionIds: string[];
  },
): Promise<{ id: string; optionIds: string[] }> {
  const key = {
    turnId_provider: { turnId: authorized.turn.id, provider: input.provider },
  };
  const select = { id: true, optionIds: true } as const;
  const asked = await prisma.sokoBotAccountQuestion.findUnique({
    where: key,
    select,
  });
  if (asked) return asked;
  try {
    return await prisma.sokoBotAccountQuestion.create({
      data: {
        sokoBotId: authorized.turn.sokoBotId,
        turnId: authorized.turn.id,
        requestedByUserId: authorized.turn.requestedByUserId,
        ...input,
      },
      select,
    });
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    return prisma.sokoBotAccountQuestion.findUniqueOrThrow({
      where: key,
      select,
    });
  }
}

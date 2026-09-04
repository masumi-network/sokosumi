import * as Sentry from "@sentry/node";
import {
  PricingType,
  TaskStatus,
  TaskX402PaymentStatus,
} from "@sokosumi/database";
import { isX402PaymentIdentifierAdvertised } from "@sokosumi/masumi/schemas";
import { convertCentsToCredits, convertCreditsToCents } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import { paymentClient } from "@/clients/masumi-payment.client";
import { getEnv } from "@/config/env";
import { requireTaskCollaboration } from "@/helpers/access-control";
import { getCreditCostsOrThrow } from "@/helpers/agent";
import {
  badGateway,
  badRequest,
  conflict,
  forbidden,
  internalServerError,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { isIdempotencyKeyUniqueConstraintError } from "@/helpers/prisma";
import {
  applyGuardedTaskStatusUpdate,
  chargeTaskCreditsOrMarkOutOfCredits,
} from "@/helpers/task-event-charge";
import { notifyTaskStatusEvent } from "@/helpers/task-notifications";
import { removeTaskSchedulePlannedOccurrences } from "@/helpers/task-schedule-occurrence-index";
import { buildX402AgentPricingListing } from "@/helpers/x402-agent-listing";
import { verifyX402DemandAgainstAgentSources } from "@/helpers/x402-payment-verify";
import { calculateCentsFromX402Amount } from "@/helpers/x402-pricing";
import {
  findX402ReadySource,
  getX402ReadySources,
} from "@/helpers/x402-readiness";
import { publishTaskEventData } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type AuthenticationContext,
  isCoworkerAuthContext,
  isOrchestratorAuthContext,
} from "@/middleware/auth";
import type { TaskX402PaymentSigned } from "@/schemas/x402-payment.schema";
import {
  finalizeVerifiedTaskX402Payment,
  heldPendingSignOutcome,
} from "@/services/task-x402-payment.finalize";
import {
  classifyNodeRefusal,
  refundRefusedTaskX402Payment,
} from "@/services/task-x402-payment.refund";
import {
  type ChargePhaseOutcome,
  calculateX402SignRiskExpiresAt,
  normalizeWithSourcesOrThrow,
  resolveExistingPayment,
  TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS,
  TASK_X402_SIGN_REQUEST_TIMEOUT_MS,
} from "@/services/task-x402-payment.replay";
import {
  createX402DemandFingerprint,
  findListedX402Agent,
  narrowOrThrow,
  sourceRequirementForEntry,
} from "@/services/task-x402-payment.replay-demand";

/**
 * Ceiling on how much of a node message is echoed into a Sentry capture.
 * These messages are the node's own text — bounded so one pathological
 * response cannot bloat an event, not because the value is untrusted output
 * (it is never returned to the caller; see TASK_X402_FAILURE_REASONS).
 */
const MAX_NODE_MESSAGE_ECHO_LENGTH = 2_000;

export interface PayTaskX402Input {
  authContext: AuthenticationContext;
  taskId: string;
  idempotencyKey: string;
  agentId: string;
  paymentRequired: unknown;
  /** Caller's pre-charge ceiling in credits — see the request schema. */
  maxCredits?: number;
}

export type PayTaskX402Result =
  | { outcome: "signed"; payment: TaskX402PaymentSigned }
  | { outcome: "out_of_credits"; attemptedCredits: number };

interface TaskEventAgentAttribution {
  coworkerId?: string;
  orchestratorId?: string;
}

/**
 * Everything that must commit atomically BEFORE the node is contacted
 * (PR1-SPEC §3.1–§3.6): authz, idempotency, verify-against-the-listed-agent,
 * pricing, the credit debit, the credit-bearing task event, and the PENDING
 * payment record. Any verification failure throws before the charge; the
 * out-of-credits path commits the same OUT_OF_CREDITS pause as the
 * task-events route.
 */
async function runX402ChargePhase(
  input: PayTaskX402Input,
  taskEventAttribution: TaskEventAgentAttribution,
): Promise<ChargePhaseOutcome> {
  const { authContext, taskId, idempotencyKey, agentId } = input;

  // Everything below this line runs BEFORE the serializable transaction opens.
  //
  // PARSING (normalizeWithSourcesOrThrow): base64 decode, `JSON.parse`, the
  // prototype-key sanitizer walk and the BigInt conversions are all
  // attacker-sized work — the resource server picks the payload size — and
  // none of it reads the database. Inside the transaction it held an open
  // SERIALIZABLE snapshot for the duration. It now rejects a malformed 402
  // before the task-collaboration check rather than after; that discloses
  // nothing, because the message is derived purely from the caller's OWN
  // payload and the coworker-agent actor gate has already run.
  //
  // CONFIG READS (readiness, credit costs): both are effectively
  // configuration — a `SyncMetadata` row the readiness cron rewrites, and the
  // whole `CreditCost` table an operator edits. Neither read belongs inside
  // the transaction. Not because their writers were SSI conflict partners —
  // they run at Prisma's default READ COMMITTED isolation, and Postgres
  // detects serialization conflicts only between SERIALIZABLE transactions —
  // but because each in-tx round trip lengthens the open serializable
  // snapshot, and with it the window in which this transaction CAN conflict
  // with concurrent serializable work (other payments, the task-events
  // route) on the rows it genuinely reads and writes.
  //
  // What that costs: both values are now read a few milliseconds before the
  // charge commits, so a write landing in that window is not seen. No
  // guarantee weakens, because neither value is trusted on its own — each is
  // re-validated against THIS demand, and a stale read fails closed:
  //  - readiness: `findX402ReadySource` must still match the demanded pair or
  //    the charge is refused pre-debit. Staleness the other way (a pair that
  //    has since stopped being ready) is caught by the node, which refuses the
  //    sign — a provable non-200, refunded synchronously. Readiness is already
  //    last-known-value by design and deliberately never expired on age, so a
  //    few milliseconds is indistinguishable from the minutes the design
  //    already accepts.
  //  - pricing: `calculateCentsFromX402Amount` still fails closed on a missing
  //    or non-positive `CreditCost` row, and the caller's `maxCredits` fence
  //    is still checked against the computed cents. SERIALIZABLE never made
  //    the price "current" either — it only turned a concurrent price edit
  //    into a 40001 the caller retried into the new price. The change is
  //    therefore 409-then-retry versus charging at the price that was live
  //    microseconds earlier.
  //
  // The atomicity that matters is untouched: the debit, the credit-bearing
  // task event and the PENDING payment row still commit together, and the
  // idempotency read/insert still races under SERIALIZABLE.
  //
  const normalization = normalizeWithSourcesOrThrow(input.paymentRequired);
  const normalized = normalization.paymentRequired;

  // Terminal idempotent results are self-contained: FAILED and REFUNDED rows
  // never change. VERIFIED moves only to REFUNDED through the operator
  // goodwill lever, so its resolver takes a FOR UPDATE lock before returning
  // the stored header (see resolveExistingPayment). Resolve them WITHOUT the
  // serializable transaction: their resolution never writes money state, and
  // a pure SSI read still joins the conflict graph where concurrent same-task
  // payment and event traffic could 409 a replay that only wanted to re-fetch
  // its stored result. Resolving before the config reads also keeps a VERIFIED
  // replay working after an agent is hidden, readiness changes, or pricing
  // is emptied.
  const task = await requireTaskCollaboration(authContext, taskId);
  const preflightPayment = await prisma.taskX402Payment.findUnique({
    where: { taskId_idempotencyKey: { taskId, idempotencyKey } },
  });
  if (
    preflightPayment !== null &&
    preflightPayment.status !== TaskX402PaymentStatus.PENDING
  ) {
    const replayArgs = {
      agentId,
      normalized,
      requirementSources: normalization.requirementSources,
    } as const;
    // VERIFIED can still flip to REFUNDED (goodwill). resolveExistingPayment
    // takes FOR UPDATE before returning the header — that lock only holds
    // inside a real transaction, so wrap VERIFIED here. FAILED/REFUNDED are
    // immutable and stay on the unlocked client.
    if (preflightPayment.status === TaskX402PaymentStatus.VERIFIED) {
      return await prisma.$transaction(async (tx) =>
        resolveExistingPayment(preflightPayment, replayArgs, task.ownerId, tx),
      );
    }
    return await resolveExistingPayment(
      preflightPayment,
      replayArgs,
      task.ownerId,
      prisma,
    );
  }

  // Only PENDING replays and fresh charges remain; both re-sign, so both
  // need readiness. Pricing is only charged on a fresh record. The
  // serializable transaction below repeats the row read and remains the
  // authority for every state transition and lease.
  const needsPricing = preflightPayment === null;
  const [readySources, creditCosts] = await Promise.all([
    getX402ReadySources(),
    needsPricing ? getCreditCostsOrThrow() : Promise.resolve(undefined),
  ]);
  const replayInput = {
    agentId,
    normalized,
    readySources,
    requirementSources: normalization.requirementSources,
  };

  return await serializableTransaction(
    async (tx): Promise<ChargePhaseOutcome> => {
      const task = await requireTaskCollaboration(authContext, taskId, tx);

      const existing = await tx.taskX402Payment.findUnique({
        where: { taskId_idempotencyKey: { taskId, idempotencyKey } },
      });
      if (existing) {
        return await resolveExistingPayment(
          existing,
          replayInput,
          task.ownerId,
          tx,
        );
      }

      if (!readySources || !creditCosts) {
        throw internalServerError(
          "Fresh x402 payment is missing buy-side configuration",
        );
      }

      const agent = await findListedX402Agent(agentId, tx);
      if (!agent) {
        throw notFound("x402 agent not found or not listed");
      }

      // Enforce the same per-agent gates as GET /v1/agents?kind=x402. Matching only
      // the demanded source would let a caller with a remembered id pay an
      // agent the listing hid because a sibling source is malformed,
      // cross-environment, or unavailable. Existing records resolve above this
      // fresh-charge gate; the replay resolver applies the status-appropriate
      // stored-tuple and current-signing checks.
      const listingContext = {
        creditCosts,
        readySources,
        network: getEnv().NETWORK,
      };
      const listing = buildX402AgentPricingListing(
        agent.paymentSources,
        listingContext,
      );
      if (listing.status === "dropped" || !listing.isPayable) {
        throw unprocessableEntity(
          "The x402 agent is not currently listed as payable on this deployment",
        );
      }

      const demand = verifyX402DemandAgainstAgentSources(
        normalized.accepts,
        agent.paymentSources,
        getEnv().NETWORK,
      );

      // Dynamic registry entries intentionally carry no price. The resource
      // server's 402 is therefore the quote, and a caller-controlled ceiling
      // is the only independent pre-debit bound. Unlike fixed pricing there is
      // no safe default: require the coworker to state what this task may
      // spend, then compare the normalized quote against it below.
      if (
        demand.pricingType === PricingType.DYNAMIC &&
        input.maxCredits === undefined
      ) {
        throw badRequest(
          "maxCredits is required for dynamically priced x402 payments. Nothing was charged.",
        );
      }

      const readySource = findX402ReadySource(
        demand.caip2Network,
        demand.asset,
        readySources,
      );
      if (!readySource) {
        throw unprocessableEntity(
          `The (${demand.caip2Network}, ${demand.asset}) pair is not buy-side ready on this deployment`,
        );
      }

      // Price via the CAIP-19 CreditCost key — throws 422 fail-closed on an
      // unpriced asset and floors the charge at MIN_CHARGEABLE_CREDITS.
      //
      // The scale comes from `readySource`, i.e. the node's own
      // `defaultAssetDecimals`, NOT from the agent's registered payment
      // source: `decimals` divides the charge, and the registry copy is
      // authored by the very agent being paid. `readySource` was just looked
      // up BY (demand.caip2Network, demand.asset), so its identity and its
      // scale cannot belong to different assets.
      const cents = calculateCentsFromX402Amount(
        { pair: readySource, amount: demand.amount },
        creditCosts,
      );

      // The caller's own ceiling, checked BEFORE the debit. Compared in cents
      // so the credits float never decides the money: convertCreditsToCents
      // is the same conversion the job-hire fence uses.
      //
      // 400, not 422, mirroring that fence ("Credit cost exceeds maximum
      // accepted credits", helpers/job.ts): the caller's own cap is the
      // blocker, so the caller can fix it by raising the cap and retrying
      // the SAME key (nothing was charged, the key is not consumed). 422 is
      // reserved for demands that are unpayable regardless of what the
      // caller sends.
      if (input.maxCredits !== undefined) {
        const maxCents = convertCreditsToCents(input.maxCredits);
        if (cents > maxCents) {
          throw badRequest(
            `This 402 prices at ${convertCentsToCredits(cents)} credits, above the maxCredits of ${input.maxCredits} you sent. Nothing was charged.`,
          );
        }
      }

      const narrowedDemand = narrowOrThrow(normalized, demand.entry);
      const sourceRequirement = sourceRequirementForEntry(
        normalized,
        normalization.requirementSources,
        demand.entry,
      );
      const demandFingerprint = createX402DemandFingerprint(
        narrowedDemand,
        sourceRequirement,
      );

      // The charge draws from the same task pool as every other task charge,
      // through the exact machinery the task-events masumiPayment branch uses.
      await requireAssignedOrganizationSeat(
        task.ownerId,
        task.organizationId,
        tx,
      );
      const charge = await chargeTaskCreditsOrMarkOutOfCredits({
        userId: task.ownerId,
        organizationId: task.organizationId,
        cents,
        currentStatus: task.status,
        tx,
      });

      if (charge.eventStatus != null) {
        // Mid-run insufficient balance: persist the OUT_OF_CREDITS pause
        // exactly like the task-events route — event, then the guarded task
        // status update. The event carries the ATTEMPTED cents (with no
        // transactionId, since nothing was debited) so the timeline shows
        // what the coworker tried to spend, not just that the task paused.
        const pauseEvent = await tx.taskEvent.create({
          data: {
            taskId,
            status: charge.eventStatus,
            ...taskEventAttribution,
            cents,
          },
        });
        await applyGuardedTaskStatusUpdate({
          tx,
          taskId,
          expectedStatus: task.status,
          eventStatus: charge.eventStatus,
        });
        if (task.status === TaskStatus.QUEUED) {
          await removeTaskSchedulePlannedOccurrences(tx, taskId);
        }
        return {
          kind: "out_of_credits",
          attemptedCredits: convertCentsToCredits(cents),
          taskOwnerId: task.ownerId,
          taskEventId: pauseEvent.id,
        };
      }
      if (!charge.transactionId) {
        // Unreachable: the charge floor guarantees cents > 0, so a successful
        // charge always creates a transaction.
        throw internalServerError("x402 charge created no transaction");
      }

      // The credit-bearing task event, like the masumiPayment task-event charge
      // — the debit stays visible on the task's event timeline.
      const chargeEvent = await tx.taskEvent.create({
        data: {
          taskId,
          cents,
          transactionId: charge.transactionId,
          ...taskEventAttribution,
        },
      });

      const signStartedAt = new Date();
      const record = await tx.taskX402Payment.create({
        data: {
          idempotencyKey,
          taskId,
          agentId,
          caip2Network: demand.caip2Network,
          asset: demand.asset,
          amount: demand.amount,
          payTo: demand.payTo,
          demandFingerprint,
          taskEventId: chargeEvent.id,
          transactionId: charge.transactionId,
          // Count the sign attempt only when payX402 is actually invoked.
          // A withheld dispatch (stall) must not spend the first-attempt
          // auto-refund slot.
          signAttemptCount: 0,
          // Hold the sign lease from the moment the record exists, so a
          // same-key request arriving while this one is at the node is refused
          // rather than racing it there.
          processingAt: signStartedAt,
          signRiskExpiresAt: calculateX402SignRiskExpiresAt(
            signStartedAt,
            demand.entry.maxTimeoutSeconds,
          ),
        },
        select: { id: true },
      });

      // Source-of-truth rule for the charged-demand fields (mirrored by the
      // PENDING replay in the replay module): on this fresh path every field
      // comes from the demand that was JUST verified, priced, and persisted —
      // the row created above stores the same tuple, so stored and verified
      // sources are identical here by construction.
      return {
        kind: "sign",
        paymentId: record.id,
        taskOwnerId: task.ownerId,
        chargedNow: true,
        signStartedAt,
        // Only the verified entry is forwarded — the node must not be handed
        // a menu it gets to choose from. See narrowOrThrow.
        normalized: narrowedDemand,
        sourceRequirement,
        evmWalletId: readySource.evmWalletId,
        evmWalletAddress: readySource.evmWalletAddress,
        x402Version: normalized.x402Version,
        caip2Network: demand.caip2Network,
        asset: demand.asset,
        amount: demand.amount,
        payTo: demand.payTo,
        scheme: demand.entry.scheme,
        maxTimeoutSeconds: demand.entry.maxTimeoutSeconds,
        domainName: demand.domainName,
        domainVersion: demand.domainVersion,
        assetTransferMethod: demand.entry.extra?.assetTransferMethod ?? null,
      };
    },
    "x402 payment changed by a concurrent request. Please retry.",
  ).catch((error) => {
    if (isIdempotencyKeyUniqueConstraintError(error)) {
      // A concurrent request with the same key won the insert race. 409 is
      // retryable: the retry replays through the idempotency branch.
      throw conflict(
        "An x402 payment with this idempotencyKey is already in flight for this task",
        { kind: "x402_payment_key_in_flight" },
      );
    }
    throw error;
  });
}

function schedulePostCommitFanout(
  taskId: string,
  taskOwnerId: string,
  outOfCreditsEventId?: string,
): void {
  waitUntil(
    (async () => {
      try {
        await publishTaskEventData({
          userId: taskOwnerId,
          taskId,
          eventType: "task_event",
        });
      } catch (error) {
        Sentry.captureException(error, {
          tags: { error_type: "publish_task_event" },
          extra: { taskId, userId: taskOwnerId },
        });
      }
    })(),
  );
  if (outOfCreditsEventId) {
    waitUntil(
      notifyTaskStatusEvent(taskId, outOfCreditsEventId, "OUT_OF_CREDITS"),
    );
  }
}

/**
 * The agent x402 pay flow (PR1-SPEC §3): a thin, verified proxy of the
 * node's `POST /x402/pay`, charged to the task's org in credits.
 *
 * Charge-then-sign: the debit, the task event, and the PENDING record commit
 * in one serializable transaction; only then is the node contacted. A node
 * first-attempt refusal (any non-200) is provably unpaid — refunded
 * synchronously, FAILED. A replay refusal cannot clear an earlier ambiguous
 * attempt's risk and remains PENDING.
 * A crash or timeout leaves the PENDING record replayable with the same
 * idempotencyKey. Before the node call, the record stores a conservative
 * `signRiskExpiresAt` fence so support cannot refund while an unseen signed
 * authorization may still be live.
 */
export async function payTaskX402(
  input: PayTaskX402Input,
): Promise<PayTaskX402Result> {
  const { authContext, taskId } = input;

  if (
    !isCoworkerAuthContext(authContext) &&
    !isOrchestratorAuthContext(authContext)
  ) {
    throw forbidden("Agent authentication required");
  }

  // Contextual coworker calls resolve collaboration before the direct-auth
  // rejection. This makes actionable task/workspace errors (for example
  // `task_parked`) win without letting context auth reach parsing, readiness
  // reads, the serializable charge transaction, or any mutation. When access
  // itself succeeds, payment still requires the coworker to act as itself.
  if (isCoworkerAuthContext(authContext) && authContext.context) {
    await requireTaskCollaboration(authContext, taskId);
    throw forbidden(
      "Direct coworker authentication required; remove X-Context-User-Id and X-Context-Organization-Id",
    );
  }

  const taskEventAttribution = isCoworkerAuthContext(authContext)
    ? { coworkerId: authContext.coworkerId }
    : { orchestratorId: authContext.orchestratorId };

  const outcome = await runX402ChargePhase(input, taskEventAttribution);

  if (outcome.kind === "replay_verified") {
    return { outcome: "signed", payment: outcome.payment };
  }

  if (outcome.kind === "out_of_credits") {
    schedulePostCommitFanout(taskId, outcome.taskOwnerId, outcome.taskEventId);
    return {
      outcome: "out_of_credits",
      attemptedCredits: outcome.attemptedCredits,
    };
  }

  if (outcome.chargedNow) {
    // The charge event is committed; surface it on the task timeline even if
    // the sign below fails.
    schedulePostCommitFanout(taskId, outcome.taskOwnerId);
  }

  // Fence-soundness guard: both persisted fences (`processingAt` lease,
  // `signRiskExpiresAt`) were stamped from `signStartedAt` INSIDE the charge
  // transaction, while the node's abort timer starts only here. If the
  // commit-to-dispatch gap has already eaten the slack those fences budget, a
  // sign now could produce an authorization outliving `signRiskExpiresAt` —
  // the window the operator resolve lever trusts. Withhold the call instead:
  // no header can exist, the record stays PENDING, and the same-key replay
  // re-stamps fresh fences before its own dispatch.
  const dispatchDelayMs = Date.now() - outcome.signStartedAt.getTime();
  if (dispatchDelayMs > TASK_X402_MAX_SIGN_DISPATCH_DELAY_MS) {
    Sentry.captureMessage(
      "x402 sign dispatch stalled past the persisted fence budget; node call withheld",
      {
        level: "error",
        tags: { error_type: "task_x402_payment_dispatch_stalled" },
        extra: { taskId, paymentId: outcome.paymentId, dispatchDelayMs },
      },
    );
    heldPendingSignOutcome();
  }

  // Fresh path only: replay already incremented inside its charge-phase txn.
  // Spend the L3 cap only now so a withheld dispatch never burns the
  // first-attempt auto-refund slot.
  if (outcome.chargedNow) {
    await prisma.taskX402Payment.update({
      where: { id: outcome.paymentId },
      data: { signAttemptCount: { increment: 1 } },
    });
  }

  // Task identity is stamped into the node call ONLY when the 402 advertises
  // the payment-identifier extension — the node 400s otherwise (ticket 011
  // Q2). A fail-loud correlation echo, never a dedup key.
  //
  // Joined with "_", NOT ":": the node validates paymentIdentifier against
  // `^[a-zA-Z0-9_-]+$` (payment.openapi.json POST /x402/pay), and a colon is
  // outside that class — it would 400, which this flow treats as a refusal
  // and refunds, silently failing every advertised-extension payment. Both
  // ids are uuid(7) (hyphenated hex), so "_" keeps the whole value legal and
  // within the 16–128 length bound.
  const advertised = isX402PaymentIdentifierAdvertised(outcome.normalized);
  const signResult = await paymentClient().payX402(
    {
      evmWalletId: outcome.evmWalletId,
      paymentRequired: outcome.normalized,
      preferredNetwork: outcome.caip2Network,
      preferredAsset: outcome.asset,
      ...(advertised
        ? { paymentIdentifier: `${taskId}_${outcome.paymentId}` }
        : {}),
    },
    { signal: AbortSignal.timeout(TASK_X402_SIGN_REQUEST_TIMEOUT_MS) },
  );

  if (signResult.isOk()) {
    const payment = await finalizeVerifiedTaskX402Payment(
      outcome.paymentId,
      signResult.value,
      {
        x402Version: outcome.x402Version,
        caip2Network: outcome.caip2Network,
        asset: outcome.asset,
        amount: outcome.amount,
        payTo: outcome.payTo,
        scheme: outcome.scheme,
        maxTimeoutSeconds: outcome.maxTimeoutSeconds,
        domainName: outcome.domainName,
        domainVersion: outcome.domainVersion,
        assetTransferMethod: outcome.assetTransferMethod,
        sourceRequirement: outcome.sourceRequirement,
        evmWalletAddress: outcome.evmWalletAddress,
      },
      taskId,
    );
    return { outcome: "signed", payment };
  }

  if (signResult.error.kind === "refused") {
    // Capture the refusal FIRST, so it is recorded even if the compensating
    // refund below (a DB write) throws — otherwise a refund failure would
    // swallow the refusal and hand the coworker a bare 500.
    Sentry.captureMessage("x402 payment refused by the payment node", {
      level: "error",
      tags: { error_type: "task_x402_payment_refused" },
      extra: {
        taskId,
        paymentId: outcome.paymentId,
        status: signResult.error.status,
        reason: signResult.error.message.slice(0, MAX_NODE_MESSAGE_ECHO_LENGTH),
      },
    });

    if (!outcome.chargedNow) {
      // This refusal proves only that the CURRENT call issued no header. The
      // PENDING row exists because an earlier call ended ambiguously, and that
      // earlier call may have produced an authorization which is still live.
      // Keep the debit held until the persisted/conservative risk window ends;
      // synchronously refunding here would restore credits while the earlier
      // authorization can still settle USDC.
      Sentry.captureMessage(
        "x402 replay refusal held behind earlier sign-risk window",
        {
          level: "warning",
          tags: { error_type: "task_x402_payment_replay_refusal_held" },
          extra: { taskId, paymentId: outcome.paymentId },
        },
      );
      throw badGateway(
        "The payment node refused this retry, but an earlier sign attempt may still have produced a live authorization. " +
          "Credits remain held on the pending record until support can resolve it after the authorization-risk window; do not use a new idempotencyKey.",
        { kind: "x402_pay_outcome_unknown" },
      );
    }

    // On the first and only attempt, non-200 ⇒ no header issued ⇒ unsettleable
    // ⇒ the synchronous refund is safe (ticket 011 Q1). If the refund write itself fails, the
    // record stays PENDING behind its sign-risk fence, recoverable by same-key
    // replay or later operator resolution — page it and tell the coworker the truth, NOT that
    // credits were refunded, because retrying with a NEW key would double-charge.
    //
    // What is PERSISTED is a code, never `signResult.error.message`: the
    // stored reason is handed back verbatim by the consumed-key 409 on the
    // next request with the same key, so storing the raw text would re-leak
    // exactly what the generic 502 below withholds. The raw text is already
    // in the capture above.
    try {
      // The boolean return distinguishes "refunded now" from "a concurrent
      // same-key request already completed the identical refund". Both mean
      // a refund exists — every NOT-refunded outcome throws instead and
      // lands in the catch — so the "Credits were refunded" responses below
      // stay truthful without branching on it.
      await refundRefusedTaskX402Payment(
        outcome.paymentId,
        classifyNodeRefusal(signResult.error.status),
      );
    } catch (refundError) {
      Sentry.captureException(refundError, {
        tags: { error_type: "task_x402_payment_refund_failed" },
        extra: { taskId, paymentId: outcome.paymentId },
      });
      throw badGateway(
        "The payment node refused the payment, but the refund could not be completed; " +
          "the charge is held on a pending record. Retry with the SAME idempotencyKey, or contact support.",
        { kind: "x402_pay_outcome_unknown" },
      );
    }

    if (signResult.error.status === 400) {
      // Deterministic pre-sign rejection of the forwarded 402 (bad accepts,
      // requirements drift, identifier not advertised) — the coworker's
      // payload is the problem, so unlike its 402/500 sibling this branch is
      // deliberately verbose.
      //
      // What it echoes is `nodeMessage` — the node's OWN `error.message` —
      // never `signResult.error.message`, which is composed with
      // `extractNodeErrorMessage` and falls back to a JSON.stringify of the
      // whole node response body. Interpolating that leaked precisely the
      // wallet/budget internals the branch below withholds, from the one
      // branch that answers in detail. Absent the node's envelope there is
      // nothing safe to repeat, so the sentence stands alone; it is sliced
      // because the node's own text is unbounded and the 402 it echoes back
      // is attacker-authored.
      const nodeDetail = signResult.error.nodeMessage
        ? `: ${signResult.error.nodeMessage.slice(0, MAX_NODE_MESSAGE_ECHO_LENGTH)}`
        : "";
      throw unprocessableEntity(
        `The payment node refused the forwarded 402 (status 400)${nodeDetail}. ` +
          "Credits were refunded; re-fetch the 402 and retry with a new idempotencyKey.",
        { kind: "x402_pay_refused" },
      );
    }
    // Budget/balance (402) or node config/signing failure (500): Soko-side
    // operational trouble, not the coworker's payload. The raw node message can
    // carry wallet/budget internals, so it stays in the Sentry capture above
    // only — the coworker gets a generic, non-leaking error.
    throw badGateway(
      "Payment could not be completed due to an operational error; retry later. " +
        "Credits were refunded; use a new idempotencyKey for a new attempt.",
      { kind: "x402_pay_refused" },
    );
  }

  // Ambiguous (timeout / transport / malformed 200): the PENDING record and
  // its charge stay put behind the persisted sign-risk fence, replayable with
  // the same key. Never refund an ambiguous outcome
  // inline: a signed header may exist that a replay can still return.
  Sentry.captureMessage("x402 sign outcome unknown; PENDING record held", {
    level: "warning",
    tags: { error_type: "task_x402_payment_ambiguous" },
    extra: {
      taskId,
      paymentId: outcome.paymentId,
      reason: signResult.error.message.slice(0, MAX_NODE_MESSAGE_ECHO_LENGTH),
    },
  });
  // The SAME generic sentence the finalize path returns, not the node's own
  // text. `extractNodeErrorMessage` falls back to a JSON.stringify of the
  // whole node response body, so interpolating it echoed exactly what the
  // refusal branch withholds a few lines up ("can carry wallet/budget
  // internals") — and there is nothing here the coworker can act on that the
  // generic sentence does not already say. The raw text is in the capture
  // above, where operators (not callers) read it.
  heldPendingSignOutcome();
}

import * as Sentry from "@sentry/node";
import { Prisma, TaskStatus } from "@sokosumi/database";
import {
  CORE_API_ERROR_KINDS,
  userTaskStatusTransitionRequiresComment,
} from "@sokosumi/utils";

import { waitUntil } from "@vercel/functions";

import { getEnv } from "@/config/env";
import {
  readWorkspaceOrganizationId,
  requireTaskCommentAccess,
  requireTaskStatusWriteAccess,
} from "@/helpers/access-control";
import { notifyLowBalanceAfterCharge } from "@/helpers/billing-notifications";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import {
  conflict,
  internalServerError,
  unprocessableEntity,
} from "@/helpers/error";
import { isV2MasumiTaskPayment } from "@/helpers/masumi-task-payment";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import { requireOwnerSeat } from "@/helpers/owner-seat";
import { isBlockchainIdentifierUniqueConstraintError } from "@/helpers/prisma";
import { created, unprocessableWithData } from "@/helpers/response";
import {
  validateQueuedRequiresRunAt,
  validateStatusTransition,
  validateTaskAssigneeAssignment,
} from "@/helpers/task";
import { resolveTaskEventActorFields } from "@/helpers/task-event-actor";
import { applyGuardedTaskStatusUpdate } from "@/helpers/task-event-charge";
import { recordTaskCommentMentions } from "@/helpers/task-event-mentions";
import {
  notifyTaskParticipantsAdded,
  notifyTaskStatusEvent,
} from "@/helpers/task-notifications";
import {
  addTaskParticipantsFromComment,
  resolveTaskCommentMentionedUserIds,
} from "@/helpers/task-participants";
import { getSelectableTaskStatuses } from "@/helpers/task-selectable-statuses";
import {
  requireNativeSeoWorkerAccess,
  requireTaskWorkerContext,
} from "@/helpers/task-worker-context";
import { publishTaskEventData } from "@/lib/ably/publish";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  createCoreLogger,
  emitCoreError,
  emitCoreWarning,
  recordCoreError,
  runAsBackgroundWork,
  tryUseLiveLogger,
} from "@/lib/evlog";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { NETWORK_BY_NAME, type Network } from "@/lib/network";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { prepareAuditSettlement } from "@/lib/seo/audit-settlement";
import { formatUpstreamErrorForLog } from "@/lib/upstream-error-log";
import { isAgentAuthContext, requireUserContext } from "@/middleware/auth";
import { paymentScope } from "@/middleware/network-scope";
import { taskEventSchema } from "@/schemas/task.schema";
import { taskWorkerContextSchema } from "@/schemas/task-worker-context.schema";
import { projectMemoryService } from "@/services/project-memory.service";
import { collectSeoAuditPerformance } from "@/services/seo-audit-performance";
import {
  requiredSeoAuditStartCheck,
  verifySeoAuditStart,
} from "@/services/seo-audit-worker-start";
import { sourceImportService } from "@/services/source-import.service";
import {
  createTaskPaymentClaim,
  processTaskPaymentClaim,
} from "@/services/task-payment-claim.service";
import { createTaskEventRoute, type TaskEventRouteMode } from "./event-route";
import { mapCreatedTaskEventForResponse } from "./map-created-event";
import { requireSeoAdmission } from "./seo-admission";
import { settleTaskEventCharge } from "./settle-charge";

export default function mount(app: OpenAPIHonoWithAuth) {
  mountTaskEventRoute(app, "standard");
  mountTaskEventRoute(app, "context");
  mountTaskEventRoute(app, "failed-admission");
  mountTaskEventRoute(app, "start-admission");
  mountTaskEventRoute(app, "seo-settlement");
}

function mountTaskEventRoute(
  app: OpenAPIHonoWithAuth,
  mode: TaskEventRouteMode,
) {
  const { baseSchema, route } = createTaskEventRoute(mode);

  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id: taskId } = c.req.valid("param");
    const payload = c.req.valid("json");
    const admission =
      "expectedLastStatusEventId" in payload || "admission" in payload
        ? payload
        : null;
    const body =
      "expectedLastStatusEventId" in payload || "admission" in payload
        ? baseSchema.parse({
            status:
              "admission" in payload ? TaskStatus.RUNNING : TaskStatus.FAILED,
            comment: payload.comment,
          })
        : payload;
    const expectedContext =
      mode === "standard"
        ? null
        : taskWorkerContextSchema.parse(
            "expectedContext" in payload ? payload.expectedContext : undefined,
          );

    const writeEvent = async (
      tx: Prisma.TransactionClient,
      checkedStart?: string,
    ) => {
      if (admission)
        await requireSeoAdmission(authContext, taskId, admission, tx);
      else if (expectedContext)
        await requireTaskWorkerContext(
          authContext,
          taskId,
          expectedContext,
          tx,
        );
      const { status, credits, authenticationUrl, channel, masumiPayment } =
        body;
      let comment = body.comment;

      const hasNonCommentWrite =
        status !== undefined ||
        credits != null ||
        authenticationUrl != null ||
        masumiPayment != null;

      const isCancelOnlyWrite =
        status === TaskStatus.CANCELED &&
        credits == null &&
        authenticationUrl == null &&
        masumiPayment == null;

      let task = hasNonCommentWrite
        ? await requireTaskStatusWriteAccess(c.var, taskId, tx)
        : await requireTaskCommentAccess(c.var, taskId, tx);

      if (!expectedContext)
        task =
          (await requireNativeSeoWorkerAccess(authContext, taskId, tx)) ?? task;
      const isAgent = isAgentAuthContext(authContext);

      if (!isCancelOnlyWrite) {
        if (isAgent) {
          // Agents spend the task billing org for its Owner.
          await requireOwnerSeat(task.ownerId, task.organizationId, tx);
        } else {
          // A person acts in the workspace the task currently lives in (move
          // does not rewrite billing org).
          await requireAssignedOrganizationSeat(
            requireUserContext(authContext).userId,
            await readWorkspaceOrganizationId(task.workspaceId, tx),
            tx,
          );
        }
      }

      if (!isAgent && credits != null) {
        throw unprocessableEntity(
          "Only the assigned coworker can set credits on task events",
        );
      }

      if (!isAgent && masumiPayment != null) {
        throw unprocessableEntity(
          "Only the assigned coworker can set masumiPayment on task events",
        );
      }

      if (
        status === undefined &&
        comment === undefined &&
        credits == null &&
        masumiPayment == null
      ) {
        throw unprocessableEntity(
          "At least one of status, comment, credits, or masumiPayment is required",
        );
      }

      if (status !== undefined) {
        validateStatusTransition(task.status, status);
        validateTaskAssigneeAssignment({
          status,
          assigneeId: task.assigneeId,
          assigneeSokoBotId: task.assigneeSokoBotId,
          assigneeUserId: task.assigneeUserId,
        });
        validateQueuedRequiresRunAt({ status, runAt: task.runAt });

        // A person may only set what the status picker offered (ADR 0029).
        if (
          !isAgent &&
          !getSelectableTaskStatuses(task, authContext).includes(status)
        ) {
          throw unprocessableEntity(
            "This status is not selectable for this task",
            { kind: CORE_API_ERROR_KINDS.STATUS_NOT_SELECTABLE },
          );
        }

        if (
          !isAgent &&
          // Task.status is never CREATED.
          userTaskStatusTransitionRequiresComment(
            task.status as Exclude<TaskStatus, "CREATED">,
            status,
            task.assigneeId !== null || task.assigneeSokoBotId !== null,
          )
        ) {
          const trimmedComment = comment?.trim();
          if (!trimmedComment) {
            throw unprocessableEntity(
              "Tell the assignee what to do: a comment is required when sending a Task back to ready",
            );
          }
          comment = trimmedComment;
        }
      }

      if (status === TaskStatus.RUNNING) {
        const auditStart = await requiredSeoAuditStartCheck(
          tx,
          task,
          authContext,
          checkedStart,
        );
        if (auditStart) return { auditStart };
      }
      let cents: bigint | undefined;
      let transactionId: string | null = null;
      let approvedAuditCompletion = false;
      const recordAuditCost = await prepareAuditSettlement(
        tx,
        task,
        body,
        isAgent && mode === "seo-settlement",
        () => {
          approvedAuditCompletion = true;
        },
      );
      let eventStatus: TaskStatus | null = status ?? null;
      let chargedMasumiPayment = false;
      let pausedForInsufficientBalance = false;
      let chargedNetwork: Network | undefined;

      if (
        isAgent &&
        (masumiPayment != null || (credits != null && credits > 0))
      ) {
        const namedNetwork = masumiPayment?.PaymentSource?.network;
        const scope = await paymentScope(c, {
          payloadNetwork: namedNetwork && NETWORK_BY_NAME[namedNetwork],
          billed: { userId: task.ownerId, organizationId: task.organizationId },
          db: tx,
        });
        const settled = await settleTaskEventCharge({
          task,
          credits,
          masumiPayment,
          scope,
          tx,
        });
        cents = settled.cents;
        transactionId = settled.transactionId;
        if (transactionId) chargedNetwork = scope.network;
        chargedMasumiPayment = settled.chargedMasumiPayment;
        if (settled.eventStatus != null) {
          eventStatus = settled.eventStatus;
          pausedForInsufficientBalance =
            settled.eventStatus === TaskStatus.OUT_OF_CREDITS;
        }
      }

      if (eventStatus === TaskStatus.OUT_OF_CREDITS || transactionId)
        await recordAuditCost?.(eventStatus);

      const actorData = resolveTaskEventActorFields(authContext);

      const createdEvent = await tx.taskEvent.create({
        data: {
          taskId,
          status: eventStatus,
          ...(comment !== undefined && { comment }),
          ...(authenticationUrl !== undefined && { authenticationUrl }),
          channel,
          ...(cents !== undefined && { cents }),
          transactionId,
          ...(chargedNetwork && { network: chargedNetwork }),
          ...actorData,
        },
      });

      let taskPaymentClaimId: string | null = null;
      if (chargedMasumiPayment && masumiPayment !== undefined) {
        if (!transactionId) {
          throw internalServerError(
            "Charged Masumi task payment has no transaction",
          );
        }
        taskPaymentClaimId = await createTaskPaymentClaim({
          network: getEnv().NETWORK,
          // Dedupe key only. Lowercased so the (network, blockchainIdentifier)
          // unique index catches a resubmission that differs solely in casing
          // — without it that payment would claim a second row, and the outbox
          // would place a second purchase for work already paid for. The
          // payload below deliberately keeps the seller's original casing,
          // which is what the node is sent.
          blockchainIdentifier:
            masumiPayment.blockchainIdentifier.toLowerCase(),
          purchasePayload: {
            blockchainIdentifier: masumiPayment.blockchainIdentifier,
            agentIdentifier: masumiPayment.agentIdentifier,
            sellerVkey: masumiPayment.sellerVkey,
            submitResultTime: masumiPayment.submitResultTime,
            payByTime: masumiPayment.payByTime,
            unlockTime: masumiPayment.unlockTime,
            externalDisputeUnlockTime: masumiPayment.externalDisputeUnlockTime,
            inputHash: masumiPayment.inputHash,
            Amounts: masumiPayment.Amounts,
            identifierFromPurchaser: masumiPayment.identifierFromPurchaser,
            paymentSourceType: masumiPayment.paymentSourceType,
            smartContractAddress: isV2MasumiTaskPayment(masumiPayment)
              ? masumiPayment.PaymentSource?.smartContractAddress
              : undefined,
            supportedPaymentSourceIndex: isV2MasumiTaskPayment(masumiPayment)
              ? masumiPayment.supportedPaymentSourceIndex
              : undefined,
            metadata: JSON.stringify({
              taskId,
              taskEventId: createdEvent.id,
            }),
          },
          taskEventId: createdEvent.id,
          transactionId,
          tx,
        });
      }

      // Update task when the caller requested a status change, or when a
      // failed charge replaced the outcome with OUT_OF_CREDITS (incl.
      // credit-only bodies that had no status).
      if (eventStatus != null) {
        await applyGuardedTaskStatusUpdate({
          tx,
          taskId,
          expectedStatus: task.status,
          eventStatus,
        });
      }

      const payment =
        chargedMasumiPayment && masumiPayment !== undefined
          ? masumiPayment
          : null;

      // Enqueue PENDING task-output files from comment (in-transaction for durability)
      let addedParticipantUserIds: string[] = [];
      if (comment) {
        await sourceImportService.enqueueTaskOutputsFromMarkdown(
          taskId,
          comment,
          tx,
        );
        const mentionedUserIds = await resolveTaskCommentMentionedUserIds(tx, {
          workspaceId: task.workspaceId,
          comment,
          visibility: task.visibility,
          ownerId: task.ownerId,
          excludeUserId: actorData.userId,
          mentionedUserIds: body.mentionedUserIds,
        });
        addedParticipantUserIds = await addTaskParticipantsFromComment(tx, {
          taskId,
          workspaceId: task.workspaceId,
          comment,
          visibility: task.visibility,
          ownerId: task.ownerId,
          excludeUserId: actorData.userId,
          resolvedMentionedUserIds: mentionedUserIds,
        });
        await recordTaskCommentMentions(tx, {
          taskId,
          taskEventId: createdEvent.id,
          authorUserId: actorData.userId ?? null,
          mentionedUserIds,
          now: new Date(),
        });
      }

      return {
        event: await mapCreatedTaskEventForResponse(tx, createdEvent.id),
        addedParticipantUserIds,
        userId: task.ownerId,
        organizationId: task.organizationId,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        masumiPayment: payment,
        taskPaymentClaimId,
        pausedForInsufficientBalance,
        charged: transactionId !== null,
        approvedAuditCompletion,
      };
    };
    const commitEvent = (checkedStart?: string) =>
      serializableTransaction(
        (tx) => writeEvent(tx, checkedStart),
        "Task changed by a concurrent request. Please retry.",
      ).catch((error) => {
        if (
          body.masumiPayment &&
          isBlockchainIdentifierUniqueConstraintError(error)
        ) {
          throw conflict(
            "A task payment with this blockchainIdentifier already exists",
          );
        }
        throw error;
      });
    const first = await commitEvent();
    const transactionResult = first.auditStart
      ? await commitEvent(await verifySeoAuditStart(first.auditStart))
      : first;
    if (transactionResult.auditStart)
      throw conflict("The audit changed before start. Try again.");
    const {
      event,
      addedParticipantUserIds,
      userId,
      organizationId,
      workspaceId,
      projectId,
      masumiPayment,
      taskPaymentClaimId,
      pausedForInsufficientBalance,
      charged,
    } = transactionResult;

    // Retry the original page and date selection at settlement if Google was unavailable at start.
    if (
      (event.status === TaskStatus.RUNNING && first.auditStart) ||
      (event.status === TaskStatus.COMPLETED &&
        transactionResult.approvedAuditCompletion)
    ) {
      waitUntil(
        runAsBackgroundWork(() => collectSeoAuditPerformance(taskId)).catch(
          (error) => {
            emitCoreWarning(
              { operation: "seo_audit_performance", taskId },
              {
                message:
                  "Could not collect the audit’s Search Console performance",
                why: "The approved statistics collection did not finish.",
                details: { failure: messageSafeErrorFields(error) },
              },
            );
          },
        ),
      );
    }

    if (event.status === TaskStatus.COMPLETED && projectId) {
      waitUntil(
        runAsBackgroundWork(() =>
          projectMemoryService.refreshAfterTaskCompleted({ projectId, taskId }),
        ).catch((error) => {
          // The memory is written from the task's text, which a database
          // error can quote: content-free fields only.
          emitCoreError(
            { operation: "project_memory_refresh", projectId, taskId },
            {
              message: "Could not refresh a project's memory after a task",
              why: "Refreshing the memory from the completed task failed",
              fix: "The project's memory misses this task until its next refresh. If it repeats, look up the error name and code under failure.",
            },
            { failure: messageSafeErrorFields(error) },
          );
          Sentry.captureException(error, {
            tags: { error_type: "project_memory_refresh_failed" },
            extra: { projectId, taskId },
          });
        }),
      );
    }

    if (event.status) {
      await deliverCalendarInvalidationsNow(workspaceId);
    }

    if (event.status || addedParticipantUserIds.length > 0) {
      waitUntil(
        runAsBackgroundWork(async () => {
          if (addedParticipantUserIds.length > 0) {
            await notifyTaskParticipantsAdded(
              taskId,
              event.id,
              addedParticipantUserIds,
            );
          }
          if (event.status) {
            await notifyTaskStatusEvent(
              taskId,
              event.id,
              event.status,
              event.userId,
            );
          }
        }),
      );
    }

    if (charged) {
      waitUntil(
        runAsBackgroundWork(() =>
          notifyLowBalanceAfterCharge({ userId, organizationId }),
        ),
      );
    }

    // Unreachable by construction (a charged payment always writes its claim
    // in the same transaction). Never throw on it: the event and its debit are
    // already committed, so throwing would answer 500 for work that succeeded.
    if (masumiPayment != null && !taskPaymentClaimId) {
      recordCoreError(
        {
          operation: "task_event_create",
          taskId,
          taskEventId: event.id,
          blockchainIdentifier: masumiPayment.blockchainIdentifier,
        },
        {
          message: "A Masumi task payment has no durable claim",
          why: "The charged event was saved without its payment claim, which the transaction should make impossible",
          fix: "No purchase is made for this payment. Find the payment by its blockchainIdentifier and buy or refund it by hand.",
        },
      );
      Sentry.captureMessage("Masumi task payment has no durable claim", {
        level: "error",
        tags: { error_type: "task_payment_claim_missing" },
        extra: {
          taskId,
          taskEventId: event.id,
          blockchainIdentifier: masumiPayment.blockchainIdentifier,
        },
      });
    }

    if (masumiPayment != null && taskPaymentClaimId) {
      const taskEventId = event.id;

      Sentry.addBreadcrumb({
        category: "task_masumi_purchase",
        message: "Scheduling task purchase (async)",
        level: "info",
        data: {
          taskId,
          taskEventId,
          blockchainIdentifier: masumiPayment.blockchainIdentifier,
        },
      });

      tryUseLiveLogger()?.set({
        taskPurchase: { scheduled: true, taskEventId },
      });

      const purchaseContext = {
        operation: "task_masumi_purchase",
        taskId,
        taskEventId,
        claimId: taskPaymentClaimId,
        blockchainIdentifier: masumiPayment.blockchainIdentifier,
      };
      // Starts before the response: background work, so nothing it logs
      // lands on this request's event.
      const masumiPurchasePromise = runAsBackgroundWork(async () => {
        try {
          const result = await processTaskPaymentClaim(taskPaymentClaimId);
          if (result.status === "purchased") {
            createCoreLogger({
              ...purchaseContext,
              purchaseId: result.purchaseId,
            }).emit();
            Sentry.addBreadcrumb({
              category: "task_masumi_purchase",
              message: "Task purchase created",
              level: "info",
              data: { taskId, purchaseId: result.purchaseId },
            });
            return;
          }
          if (result.status === "refunded") {
            Sentry.captureMessage(
              `Task purchase permanently rejected: ${result.reason}`,
              {
                level: "error",
                tags: {
                  error_type: "task_purchase_permanent_failure",
                  compensated: String(result.compensated),
                },
                extra: {
                  taskId,
                  taskEventId,
                  claimId: taskPaymentClaimId,
                  blockchainIdentifier: masumiPayment.blockchainIdentifier,
                },
              },
            );
            return;
          }
          if (result.status === "retry_scheduled") {
            // The processor returns the payment node's full reason: capped,
            // and only in `cause`, where redaction runs.
            emitCoreWarning(purchaseContext, {
              message: "Scheduled a retry of a Masumi task purchase",
              why: "The payment node did not accept the purchase yet",
              fix: "The task-payment-claims sync retries it. If it keeps retrying, read the payment node's reason in cause.",
              cause: formatUpstreamErrorForLog(result.reason),
            });
          }
        } catch (error) {
          // Durable PENDING claim remains recoverable by cron. Never refund an
          // ambiguous branch: remote purchase may already exist.
          // Scheduling a retry writes the payment node's reason, and a Prisma
          // validation error quotes it: content-free fields only.
          emitCoreError(
            purchaseContext,
            {
              message: "A Masumi task purchase failed before it finished",
              why: "Processing the payment claim threw",
              fix: "The claim stays PENDING and the task-payment-claims sync recovers it; never refund it by hand, the purchase may exist. Look up the error name and code under failure.",
            },
            { failure: messageSafeErrorFields(error) },
          );
          Sentry.captureException(error, {
            tags: { error_type: "task_purchase_processor_failed" },
            extra: { taskId, taskEventId, claimId: taskPaymentClaimId },
          });
        }
      });

      waitUntil(masumiPurchasePromise);
    }

    // Live updates go to the Owner; work without one has nobody to tell.
    const taskIdsToPublish = userId ? [{ userId, taskId }] : [];

    await Promise.all(
      taskIdsToPublish.map(
        async ({ userId: publishUserId, taskId: publishTaskId }) => {
          try {
            await publishTaskEventData({
              userId: publishUserId,
              taskId: publishTaskId,
              eventType: "task_event",
            });
          } catch (error) {
            Sentry.captureException(error, {
              tags: {
                error_type: "publish_task_event",
              },
              extra: {
                taskId: publishTaskId,
                userId: publishUserId,
              },
            });
          }
        },
      ),
    );

    const parsedEvent = taskEventSchema.parse(event);

    // Charge failed but OUT_OF_CREDITS pause was committed — not what the
    // requester asked to create, so 422 with the pause event in `data`.
    if (pausedForInsufficientBalance) {
      return unprocessableWithData(c, parsedEvent, {
        message: "Insufficient balance",
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE,
        attemptedCredits: parsedEvent.credits ?? undefined,
        requestedStatus: body.status ?? null,
      });
    }

    return created(c, parsedEvent);
  });
}

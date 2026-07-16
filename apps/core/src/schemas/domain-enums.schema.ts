import { z } from "@hono/zod-openapi";
import {
  AgentJobStatus,
  BlobStatus,
  Channel,
  InvitationStatus,
  JobType,
  MemberRole,
  NoticeKind,
  OnChainJobStatus,
  RiskClassification,
  SokosumiJobStatus,
  TaskStatus,
} from "@sokosumi/utils";
import type Stripe from "stripe";

/**
 * Named OpenAPI enum schemas.
 *
 * Each `.openapi("Name")` registers a reusable component so `@hey-api/openapi-ts`
 * with `enums: "javascript"` emits `export const Name = { … }` in the web Core
 * client. Keep domain enums here; feature-local enums (Hermes, Skills, …) may
 * stay next to their schemas when they are not shared.
 *
 * Value sources are `@sokosumi/utils` const maps (client-safe mirrors of Prisma /
 * Postgres). Utils ↔ Prisma drift is guarded in `@sokosumi/database`
 * (`status-enums-drift.test.ts`); do not import Prisma enums here.
 *
 * Decision (SOK-590): keep codegen output web-only under
 * `apps/web/src/lib/clients/generated/core` — same as `TaskLinkRelation`. A
 * shared `packages/api-types` package is unnecessary while only web consumes
 * the generated client.
 */

export const taskStatusSchema = z.enum(TaskStatus).openapi("TaskStatus");

export const agentJobStatusSchema = z
  .enum(AgentJobStatus)
  .openapi("AgentJobStatus");

export const jobTypeSchema = z.enum(JobType).openapi("JobType");

export const blobStatusSchema = z.enum(BlobStatus).openapi("BlobStatus");

export const channelSchema = z.enum(Channel).openapi("Channel");

export const sokosumiJobStatusSchema = z
  .enum(SokosumiJobStatus)
  .openapi("SokosumiJobStatus");

export const onChainJobStatusSchema = z
  .enum(OnChainJobStatus)
  .openapi("OnChainJobStatus");

export const noticeKindSchema = z.enum(NoticeKind).openapi("NoticeKind");

export const riskClassificationSchema = z
  .enum(RiskClassification)
  .openapi("RiskClassification");

/** Stored organization member roles (Postgres string column, not a Prisma enum). */
export const MEMBER_ROLE_VALUES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.MEMBER,
] as const;

export const memberRoleSchema = z
  .enum(MEMBER_ROLE_VALUES)
  .openapi("MemberRole", {
    example: MemberRole.MEMBER,
    description: "Organization member role",
  });

// Prefer `z.union([namedEnum, z.null()])` over `namedEnum.nullable().openapi({
// enum: [...values, null] })`. The latter can overwrite the named OpenAPI
// component and make hey-api emit `NULL: null` on the runtime const map.
export const memberRoleNullableSchema = z
  .union([memberRoleSchema, z.null()])
  .openapi({
    example: MemberRole.MEMBER,
    description: "Organization member role, or null when absent",
  });

/** Invitation statuses persisted in Postgres (excludes frontend-only `expired`). */
export const INVITATION_DB_STATUS_VALUES = [
  InvitationStatus.PENDING,
  InvitationStatus.ACCEPTED,
  InvitationStatus.REJECTED,
  InvitationStatus.CANCELED,
] as const;

export const invitationStatusSchema = z
  .enum(INVITATION_DB_STATUS_VALUES)
  .openapi("InvitationStatus", {
    example: InvitationStatus.PENDING,
    description: "Invitation lifecycle status stored in the database",
  });

/** Stripe subscription statuses mirrored in our persisted Subscription.status. */
export const STRIPE_SUBSCRIPTION_STATUS_VALUES = [
  "active",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "paused",
  "trialing",
  "unpaid",
] as const satisfies readonly Stripe.Subscription.Status[];

type MissingStripeSubscriptionStatus = Exclude<
  Stripe.Subscription.Status,
  (typeof STRIPE_SUBSCRIPTION_STATUS_VALUES)[number]
>;

const _stripeSubscriptionStatusValuesAreExhaustive: Record<
  MissingStripeSubscriptionStatus,
  never
> = {};

export const stripeSubscriptionStatusSchema = z
  .enum(STRIPE_SUBSCRIPTION_STATUS_VALUES)
  .openapi("StripeSubscriptionStatus", {
    example: "active",
    description: "Stripe subscription lifecycle status",
  });

export const stripeSubscriptionStatusNullableSchema = z
  .union([stripeSubscriptionStatusSchema, z.null()])
  .openapi({
    example: "active",
    description: "Stripe subscription lifecycle status, or null when absent",
  });

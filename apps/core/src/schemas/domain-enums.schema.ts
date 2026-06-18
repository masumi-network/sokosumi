import { z } from "@hono/zod-openapi";
import { InvitationStatus, MemberRole } from "@sokosumi/database";
import type Stripe from "stripe";

/** Stored organization member roles (Postgres string column, not a Prisma enum). */
export const MEMBER_ROLE_VALUES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.MEMBER,
] as const;

export const memberRoleSchema = z.enum(MEMBER_ROLE_VALUES).openapi({
  example: MemberRole.MEMBER,
  description: "Organization member role",
});

// `enum` is set explicitly here: `z.enum(...).nullable()` emits
// `type: ["string", "null"]` but keeps the non-null enum, which makes the
// generated client drop the nullable union. Listing `null` in the enum keeps
// the OpenAPI artifact and generated type (`... | null`) consistent.
export const memberRoleNullableSchema = memberRoleSchema.nullable().openapi({
  example: MemberRole.MEMBER,
  enum: [...MEMBER_ROLE_VALUES, null],
  description: "Organization member role",
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
  .openapi({
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
  .openapi({
    example: "active",
    description: "Stripe subscription lifecycle status",
  });

export const stripeSubscriptionStatusNullableSchema =
  stripeSubscriptionStatusSchema.nullable().openapi({
    example: "active",
    enum: [...STRIPE_SUBSCRIPTION_STATUS_VALUES, null],
    description: "Stripe subscription lifecycle status, or null when absent",
  });

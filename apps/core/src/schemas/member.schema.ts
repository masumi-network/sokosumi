import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { organizationRecordSchema } from "@/schemas/organization.schema";

const memberUserSchema = z.object({
  id: z.string().openapi({ example: "user_123" }),
  name: z.string().openapi({ example: "Jane Doe" }),
  email: z.string().openapi({ example: "jane@example.com" }),
  image: z
    .string()
    .nullable()
    .openapi({ example: "https://example.com/avatar.png" }),
});

export const memberWithUserSchema = z
  .object({
    id: z.string().openapi({ example: "member_123" }),
    organizationId: z.string().openapi({ example: "org_123" }),
    role: z.string().openapi({ example: "member" }),
    seatAssignedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    user: memberUserSchema,
    lastSeenAt: dateTimeSchema.nullable().openapi({
      description:
        "Most recent session activity for the member (max Session.updatedAt); null if the member has never had a session.",
    }),
  })
  .openapi("Member");

export type MemberWithUser = z.infer<typeof memberWithUserSchema>;

export const membersSchema = z.array(memberWithUserSchema);

/**
 * Raw member record for the authenticated user (no relations). Mirrors the
 * Prisma `Member` model so web callers can keep consuming the database
 * `Member` type unchanged.
 */
export const memberRecordSchema = z
  .object({
    id: z.string().openapi({ example: "member_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z.string().openapi({ example: "org_123" }),
    role: z.string().openapi({ example: "member" }),
    seatAssignedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
  })
  .openapi("MemberRecord");

export type MemberRecord = z.infer<typeof memberRecordSchema>;

/**
 * A membership of the authenticated user including the embedded organization
 * record (see {@link organizationRecordSchema}). Shape mirrors the Prisma
 * `MemberWithOrganization` type.
 */
export const memberWithOrganizationSchema = z
  .object({
    id: z.string().openapi({ example: "member_123" }),
    userId: z.string().openapi({ example: "user_123" }),
    organizationId: z.string().openapi({ example: "org_123" }),
    role: z.string().openapi({ example: "member" }),
    seatAssignedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    organization: organizationRecordSchema,
  })
  .openapi("MemberWithOrganization");

export type MemberWithOrganization = z.infer<
  typeof memberWithOrganizationSchema
>;

export const membersWithOrganizationSchema = z.array(
  memberWithOrganizationSchema,
);

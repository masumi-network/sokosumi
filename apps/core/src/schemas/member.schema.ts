import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

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

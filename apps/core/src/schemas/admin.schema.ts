import { z } from "@hono/zod-openapi";
import { MemberRole, TaskStatus } from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { dateTimeSchema } from "@/helpers/datetime";
import {
  memberRoleSchema,
  stripeSubscriptionStatusNullableSchema,
  taskStatusSchema,
} from "@/schemas/domain-enums.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskSchema } from "@/schemas/task.schema";

/**
 * Lower page-size cap than the global pagination limit: every overview row
 * fans out into per-user credit and subscription queries, so large pages
 * multiply database load.
 */
export const ADMIN_USER_OVERVIEW_MAX_LIMIT = 50;

export const adminSearchQuerySchema = z.object({
  query: z
    .string()
    .optional()
    .openapi({
      param: { name: "query", in: "query" },
      description:
        "Search term matched against name and email (users) or name and slug (organizations). Empty or whitespace-only queries return an empty list.",
      example: "acme",
    }),
});

export const adminUserOptionSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    email: z.string().openapi({ example: "ada@example.com" }),
  })
  .openapi("AdminUserOption");

export const adminUserSearchResponseSchema = z.array(adminUserOptionSchema);

export const adminOrganizationOptionSchema = z
  .object({
    id: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Acme Corp" }),
    slug: z.string().openapi({ example: "acme-corp" }),
  })
  .openapi("AdminOrganizationOption");

export const adminOrganizationSearchResponseSchema = z.array(
  adminOrganizationOptionSchema,
);

export const adminUserOverviewQuerySchema = z
  .object({
    query: z
      .string()
      .optional()
      .openapi({
        param: { name: "query", in: "query" },
        description:
          "Optional search term matched case-insensitively against user name and email. Empty or missing lists all users.",
        example: "ada",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape)
  .extend({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_USER_OVERVIEW_MAX_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of items to return (max ${ADMIN_USER_OVERVIEW_MAX_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  });

export const adminUserOverviewItemSchema = z
  .object({
    id: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    email: z.string().openapi({ example: "ada@example.com" }),
    createdAt: dateTimeSchema,
    credits: z.number().openapi({
      description: "Available personal credits",
      example: 42.5,
    }),
    subscriptionPlan: z.string().nullable().openapi({
      description: "Active subscription plan, if any",
      example: "pro",
    }),
    subscriptionStatus: stripeSubscriptionStatusNullableSchema,
    startedTaskCount: z.number().int().min(0).openapi({
      description: "Number of tasks the user has started (status beyond DRAFT)",
      example: 7,
    }),
  })
  .openapi("AdminUserOverviewItem");

export const adminUserOverviewListSchema = z.array(adminUserOverviewItemSchema);

export const adminOrganizationSlugParamSchema = z.object({
  slug: z.string().openapi({
    param: { name: "slug", in: "path" },
    example: "acme-corp",
  }),
});

export const ADMIN_ORGANIZATION_OVERVIEW_MAX_LIMIT = 50;

export const adminOrganizationOverviewQuerySchema = z
  .object({
    query: z
      .string()
      .optional()
      .openapi({
        param: { name: "query", in: "query" },
        description:
          "Optional search term matched case-insensitively against organization name and slug. Empty or missing lists all organizations.",
        example: "acme",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape)
  .extend({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_ORGANIZATION_OVERVIEW_MAX_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of items to return (max ${ADMIN_ORGANIZATION_OVERVIEW_MAX_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  });

export const adminOrganizationOverviewItemSchema = z
  .object({
    id: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Acme Corp" }),
    slug: z.string().openapi({ example: "acme-corp" }),
    createdAt: dateTimeSchema,
    memberCount: z.number().int().min(0).openapi({ example: 12 }),
    billingMode: z.enum(["enterprise_contract", "self_serve"]).openapi({
      example: "self_serve",
    }),
    billingPlan: z
      .enum(["free", "starter", "standard", "pro", "enterprise"])
      .openapi({ example: "starter" }),
    purchasedSeats: z.number().int().openapi({ example: 5 }),
    subscriptionPlan: z.string().nullable().openapi({
      description: "Active organization subscription plan, if any",
      example: "starter",
    }),
    subscriptionStatus: stripeSubscriptionStatusNullableSchema,
  })
  .openapi("AdminOrganizationOverviewItem");

export const adminOrganizationOverviewListSchema = z.array(
  adminOrganizationOverviewItemSchema,
);

export const adminOrganizationMemberOverviewItemSchema = z
  .object({
    id: z.string().openapi({ example: "member_123" }),
    organizationId: z.string().openapi({ example: "org_123" }),
    role: memberRoleSchema.openapi({ example: MemberRole.MEMBER }),
    seatAssignedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    user: z.object({
      id: z.string().openapi({ example: "user_123" }),
      name: z.string().openapi({ example: "Jane Doe" }),
      email: z.string().openapi({ example: "jane@example.com" }),
    }),
    lastSeenAt: dateTimeSchema.nullable(),
    subscriptionPlan: z.string().nullable().openapi({
      description:
        "Organization subscription plan, repeated on each member row",
      example: "starter",
    }),
    subscriptionStatus: stripeSubscriptionStatusNullableSchema,
  })
  .openapi("AdminOrganizationMemberOverviewItem");

export const ADMIN_ORGANIZATION_MEMBER_OVERVIEW_MAX_LIMIT = 50;

export const adminOrganizationMemberOverviewQuerySchema = z
  .object({})
  .extend(cursorPaginationQuerySchema.shape)
  .extend({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_ORGANIZATION_MEMBER_OVERVIEW_MAX_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of members to return (max ${ADMIN_ORGANIZATION_MEMBER_OVERVIEW_MAX_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  });

export const adminOrganizationMemberOverviewListSchema = z.array(
  adminOrganizationMemberOverviewItemSchema,
);

export const adminOrganizationOverviewDetailSchema = z
  .object({
    organization: z.object({
      id: z.string().openapi({ example: "org_123" }),
      name: z.string().openapi({ example: "Acme Corp" }),
      slug: z.string().openapi({ example: "acme-corp" }),
      createdAt: dateTimeSchema,
      stripeCustomerId: z.string().nullable().openapi({
        example: "cus_123",
      }),
    }),
    billingPlan: z.object({
      mode: z.enum(["enterprise_contract", "self_serve"]),
      plan: z.enum(["free", "starter", "standard", "pro", "enterprise"]),
      isConsumable: z.boolean(),
      purchasedSeats: z.number().int(),
      cancelAtPeriodEnd: z.boolean(),
      periodEnd: dateTimeSchema.nullable(),
    }),
    subscription: z
      .object({
        plan: z.string(),
        status: z.string(),
        cancelAtPeriodEnd: z.boolean(),
        periodStart: dateTimeSchema.nullable(),
        periodEnd: dateTimeSchema.nullable(),
        seats: z.number().int(),
      })
      .nullable(),
    enterpriseContract: z
      .object({
        poolRemainingCredits: z.number(),
        monthlyCredits: z.number().nullable(),
        purchasedSeats: z.number().int(),
        isConsumable: z.boolean(),
      })
      .nullable(),
    seatSummary: z.object({
      assignedCount: z.number().int(),
      memberCount: z.number().int(),
      purchasedSeats: z.number().int(),
      unusedSeats: z.number().int(),
      paidPlan: z.string().nullable(),
      isEnterpriseContract: z.boolean(),
    }),
    totalCredits: z.number().openapi({
      description: "Organization pool remaining credits for both billing modes",
      example: 1200,
    }),
  })
  .openapi("AdminOrganizationOverviewDetail");

export const adminAddOrganizationMemberBodySchema = z
  .object({
    userId: z.string().min(1).openapi({
      description: "User ID to add as a member",
      example: "user_123",
    }),
    role: memberRoleSchema.default(MemberRole.MEMBER).openapi({
      example: MemberRole.MEMBER,
    }),
  })
  .openapi("AdminAddOrganizationMemberBody");

export const adminUpdateOrganizationMemberRoleBodySchema = z
  .object({
    role: memberRoleSchema.openapi({
      example: MemberRole.ADMIN,
    }),
  })
  .openapi("AdminUpdateOrganizationMemberRoleBody");

export const adminOrganizationMemberIdParamSchema = z.object({
  slug: z.string().openapi({
    param: { name: "slug", in: "path" },
    example: "acme-corp",
  }),
  memberId: z.string().openapi({
    param: { name: "memberId", in: "path" },
    example: "member_123",
  }),
});

export const adminExternalChannelOptionSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({ example: "External Channel" }),
    slug: z.string().openapi({ example: "external-channel" }),
  })
  .openapi("AdminExternalChannelOption");

export const adminExternalChannelOptionListSchema = z.array(
  adminExternalChannelOptionSchema,
);

export const adminCreateExternalChannelBodySchema = z
  .object({
    name: z.string().trim().max(80).optional().openapi({
      description:
        "Channel display name (max 80). If omitted or blank, Core derives title-case words from the slug.",
      example: "Partners",
    }),
    slug: z.string().openapi({
      description:
        "Required Channel slug (max 80 after sanitize). Unique among Channels in the host organization.",
      example: "partners",
    }),
    topic: z.string().trim().max(200).optional().openapi({
      example: "Partner coordination",
    }),
  })
  .openapi("AdminCreateExternalChannelBody");

export const adminExternalChannelRoomParamsSchema =
  adminOrganizationSlugParamSchema.extend({
    roomId: z
      .string()
      .uuid()
      .openapi({
        param: { name: "roomId", in: "path" },
        example: "550e8400-e29b-41d4-a716-446655440000",
      }),
  });

export const adminExternalChannelGuestInfoSchema = z
  .object({
    userId: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Guest User" }),
    email: z.string().openapi({ example: "guest@example.com" }),
  })
  .openapi("AdminExternalChannelGuestInfo");

export const adminExternalChannelDetailSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({ example: "External Channel" }),
    slug: z.string().openapi({ example: "external-channel" }),
    topic: z.string().nullable().openapi({ example: "Partner coordination" }),
    guests: z.array(adminExternalChannelGuestInfoSchema),
  })
  .openapi("AdminExternalChannelDetail");

export const adminAddExternalChannelGuestParamsSchema =
  adminExternalChannelRoomParamsSchema;

export const adminAddExternalChannelGuestBodySchema = z
  .object({
    userId: z.string().min(1).openapi({
      description: "Existing platform user to add as a guest",
      example: "user_123",
    }),
  })
  .openapi("AdminAddExternalChannelGuestBody");

export const adminExternalChannelGuestSchema = z
  .object({
    userId: z.string().openapi({ example: "user_123" }),
    roomId: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    access: z.literal("guest").openapi({ example: "guest" }),
    outcome: z.enum(["joined", "already_guest"]).openapi({
      example: "joined",
    }),
  })
  .openapi("AdminExternalChannelGuest");

export const adminMatchedChannelOptionSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({ example: "Matched Channel" }),
    slug: z.string().openapi({ example: "matched-channel" }),
  })
  .openapi("AdminMatchedChannelOption");

export const adminMatchedChannelOptionListSchema = z.array(
  adminMatchedChannelOptionSchema,
);

export const adminCreateMatchedChannelBodySchema = z
  .object({
    name: z.string().trim().max(80).optional().openapi({
      description:
        "Channel display name (max 80). If omitted or blank, Core derives title-case words from the slug.",
      example: "Partners",
    }),
    slug: z.string().openapi({
      description:
        "Required Channel slug (max 80 after sanitize). Unique among org-less matched channels.",
      example: "partners",
    }),
    topic: z.string().trim().max(200).optional().openapi({
      example: "Partner coordination",
    }),
  })
  .openapi("AdminCreateMatchedChannelBody");

export const adminMatchedChannelRoomParamsSchema = z.object({
  roomId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "roomId", in: "path" },
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
});

export const adminMatchedChannelParticipantInfoSchema = z
  .object({
    userId: z.string().openapi({ example: "user_123" }),
    name: z.string().openapi({ example: "Ada Lovelace" }),
    email: z.string().openapi({ example: "ada@example.com" }),
    access: z.literal("member").openapi({ example: "member" }),
  })
  .openapi("AdminMatchedChannelParticipantInfo");

export const adminMatchedChannelDetailSchema = z
  .object({
    id: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({ example: "Matched Channel" }),
    slug: z.string().openapi({ example: "matched-channel" }),
    topic: z.string().nullable().openapi({ example: "Partner coordination" }),
    participants: z.array(adminMatchedChannelParticipantInfoSchema),
  })
  .openapi("AdminMatchedChannelDetail");

export const adminAddMatchedChannelParticipantBodySchema = z
  .object({
    userId: z.string().min(1).openapi({
      description: "Existing platform user to add as a member",
      example: "user_123",
    }),
  })
  .openapi("AdminAddMatchedChannelParticipantBody");

export const adminMatchedChannelParticipantSchema = z
  .object({
    userId: z.string().openapi({ example: "user_123" }),
    roomId: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    access: z.literal("member").openapi({ example: "member" }),
    outcome: z.enum(["joined", "already_member"]).openapi({
      example: "joined",
    }),
  })
  .openapi("AdminMatchedChannelParticipant");

export const adminAddMatchedChannelFromOrganizationBodySchema = z
  .object({
    organizationId: z.string().min(1).optional().openapi({
      description: "Organization whose Members are snapshotted onto the roster",
      example: "org_123",
    }),
    organizationSlug: z.string().min(1).optional().openapi({
      description: "Organization slug alternative to organizationId",
      example: "acme-corp",
    }),
  })
  .refine(
    (data) =>
      (data.organizationId != null && data.organizationSlug == null) ||
      (data.organizationId == null && data.organizationSlug != null),
    {
      message: "Provide exactly one of organizationId or organizationSlug",
    },
  )
  .openapi("AdminAddMatchedChannelFromOrganizationBody");

export const adminAddMatchedChannelFromOrganizationResultSchema = z
  .object({
    added: z.number().int().nonnegative().openapi({ example: 3 }),
    alreadyMember: z.number().int().nonnegative().openapi({ example: 1 }),
    totalMembers: z.number().int().nonnegative().openapi({ example: 4 }),
  })
  .openapi("AdminAddMatchedChannelFromOrganizationResult");

/**
 * Same rationale as the user overview cap: keep admin list pages bounded.
 */
export const ADMIN_TASK_LIST_MAX_LIMIT = 50;

export const adminTaskListQuerySchema = z
  .object({
    query: z
      .string()
      .max(255)
      .optional()
      .openapi({
        param: { name: "query", in: "query" },
        description:
          "Optional search term matched against task ID (exact), task name, user name and email, and organization name and slug (case-insensitive). Empty or missing lists all tasks.",
        example: "acme",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape)
  .extend({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ADMIN_TASK_LIST_MAX_LIMIT)
      .default(LIMITS.DEFAULT_PAGINATION_LIMIT)
      .openapi({
        param: { name: "limit", in: "query" },
        description: `Number of items to return (max ${ADMIN_TASK_LIST_MAX_LIMIT})`,
        example: LIMITS.DEFAULT_PAGINATION_LIMIT,
      }),
  });

const adminTaskOwnerSchema = z.object({
  id: z.string().openapi({ example: "user_123" }),
  name: z.string().openapi({ example: "Ada Lovelace" }),
  email: z.string().openapi({ example: "ada@example.com" }),
});

export const adminTaskListItemSchema = z
  .object({
    id: z.string().openapi({ example: "0195b9f4-7d35-7a4e-b14e-111111111111" }),
    name: z.string().openapi({ example: "Quarterly report" }),
    status: taskStatusSchema.openapi({ example: TaskStatus.RUNNING }),
    createdAt: dateTimeSchema,
    owner: adminTaskOwnerSchema,
    /** @deprecated Use `owner`. */
    user: adminTaskOwnerSchema.openapi({
      deprecated: true,
      description: "Deprecated. Use owner instead.",
    }),
    organization: z
      .object({
        id: z.string().openapi({ example: "org_123" }),
        name: z.string().openapi({ example: "Acme Corp" }),
        slug: z.string().openapi({ example: "acme-corp" }),
      })
      .nullable(),
  })
  .openapi("AdminTaskListItem");

export const adminTaskListSchema = z.array(adminTaskListItemSchema);

export const adminTaskIdParamSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "0195b9f4-7d35-7a4e-b14e-111111111111",
  }),
});

/**
 * Full task payload (same shape the user-facing task view consumes) plus the
 * owner and organization context the admin views need.
 */
export const adminTaskDetailSchema = z
  .object({
    task: taskSchema,
    owner: adminTaskOwnerSchema,
    /** @deprecated Use `owner`. */
    user: adminTaskOwnerSchema.openapi({
      deprecated: true,
      description: "Deprecated. Use owner instead.",
    }),
    organization: z
      .object({
        id: z.string().openapi({ example: "org_123" }),
        name: z.string().openapi({ example: "Acme Corp" }),
        slug: z.string().openapi({ example: "acme-corp" }),
      })
      .nullable(),
  })
  .openapi("AdminTaskDetail");

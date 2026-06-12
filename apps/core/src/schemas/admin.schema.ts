import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";

import { LIMITS } from "@/config/constants";
import { dateTimeSchema } from "@/helpers/datetime";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";

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
    subscriptionStatus: z.string().nullable().openapi({ example: "active" }),
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

/**
 * Same rationale as the user overview cap: keep admin list pages bounded.
 */
export const ADMIN_TASK_LIST_MAX_LIMIT = 50;

export const adminTaskListQuerySchema = z
  .object({
    query: z
      .string()
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

export const adminTaskListItemSchema = z
  .object({
    id: z.string().openapi({ example: "0195b9f4-7d35-7a4e-b14e-111111111111" }),
    name: z.string().openapi({ example: "Quarterly report" }),
    status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
    createdAt: dateTimeSchema,
    user: z.object({
      id: z.string().openapi({ example: "user_123" }),
      name: z.string().openapi({ example: "Ada Lovelace" }),
      email: z.string().openapi({ example: "ada@example.com" }),
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

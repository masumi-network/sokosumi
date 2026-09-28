import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

/**
 * Transaction History is the credit ledger, not an activity feed. One row is
 * one `Transaction` that took credits from the account, labelled by whichever
 * entity links to it. Rows carry the consumption date, which is the ledger
 * row's own `createdAt` and therefore immune to the row-touch writes that
 * corrupted the old `history.sortAt` projection.
 */
export const transactionHistoryKinds = [
  "job",
  "image",
  "task",
  "coworker",
  "sokoBot",
  "unattributed",
] as const;

const transactionHistoryOwnerObjectSchema = z
  .object({
    userId: z.string().openapi({
      description: "User the credits were taken from",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    name: z.string().openapi({
      description: "Display name of the user",
      example: "Alice Johnson",
    }),
    image: z.string().nullable().openapi({
      description: "Profile image URL. Null when no image is set.",
      example: "https://example.com/avatar.jpg",
    }),
  })
  .openapi("TransactionHistoryOwner");

const transactionHistoryBaseItemSchema = z.object({
  id: z.string().openapi({
    description:
      "Transaction ID. This is the ledger row's own ID and the pagination cursor.",
    example: "01960001-0001-7001-8001-000000000001",
  }),
  title: z.string().openapi({
    description: "Display label for what the credits were spent on",
    example: "Research competitors",
  }),
  description: z.string().nullable().openapi({
    description: "Secondary detail about the consumption, when one is known",
    example: "Research Agent",
  }),
  credits: z.number().openapi({
    description:
      "Credits taken from the account, always positive. Derived from the negative ledger amount.",
    example: 5,
  }),
  consumedAt: dateTimeSchema.openapi({
    description:
      "When the credits were taken (`Transaction.createdAt`). The list sorts by this field.",
  }),
  projectId: z.string().uuid().nullable().openapi({
    description:
      "Project the consumption belongs to. Null for sources that are not project-scoped.",
    example: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  }),
  // Union-with-null instead of `.nullable()` on the named schema: `.nullable()`
  // leaks `| null` into the generated component and makes the client
  // transformer call the owner converter unconditionally. Mirrors
  // `jobSchema.share` / `taskSchema.share`.
  owner: z.union([transactionHistoryOwnerObjectSchema, z.null()]).openapi({
    description:
      "User the credits were taken from. Null for organization-level consumptions with no user, or when the user was deleted.",
    example: null,
  }),
});

export const transactionHistoryJobItemSchema = transactionHistoryBaseItemSchema
  .extend({
    kind: z.literal("job"),
    jobId: z.string().openapi({
      description: "Job that consumed the credits",
      example: "job_123",
    }),
    agentId: z.string().nullable().openapi({
      description: "Agent that ran the job, for deep-linking",
      example: "agent_123",
    }),
    agentName: z.string().nullable().openapi({
      description: "Resolved display name of the agent",
      example: "Research Agent",
    }),
    agentIcon: z.string().nullable().openapi({
      description: "Resolved icon URL for the agent",
      example: "https://example.com/research.svg",
    }),
  })
  .openapi("TransactionHistoryJobItem");

export const transactionHistoryImageItemSchema =
  transactionHistoryBaseItemSchema
    .extend({
      kind: z.literal("image"),
      imageJobId: z.string().uuid().openapi({
        description: "Image studio generation that consumed the credits",
        example: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      modelLabel: z.string().openapi({
        description:
          "Display name of the model, resolved from the studio catalog. Falls back to the provider endpoint for a model the catalog no longer lists.",
        example: "Gemini 3.1 Flash Image",
      }),
    })
    .openapi("TransactionHistoryImageItem");

export const transactionHistoryTaskItemSchema = transactionHistoryBaseItemSchema
  .extend({
    kind: z.literal("task"),
    taskId: z.string().openapi({
      description: "Task whose event consumed the credits",
      example: "tsk_123",
    }),
    taskEventId: z.string().openapi({
      description: "Task event that carries the charge",
      example: "evt_123",
    }),
  })
  .openapi("TransactionHistoryTaskItem");

export const transactionHistoryCoworkerItemSchema =
  transactionHistoryBaseItemSchema
    .extend({
      kind: z.literal("coworker"),
      coworkerId: z.string().openapi({
        description: "Coworker whose usage consumed the credits",
        example: "cow_123",
      }),
    })
    .openapi("TransactionHistoryCoworkerItem");

export const transactionHistorySokoBotItemSchema =
  transactionHistoryBaseItemSchema
    .extend({
      kind: z.literal("sokoBot"),
      sokoBotId: z.string().uuid().openapi({
        description: "Soko Bot whose usage consumed the credits",
        example: "01960001-0001-7001-8001-000000000099",
      }),
    })
    .openapi("TransactionHistorySokoBotItem");

export const transactionHistoryUnattributedItemSchema =
  transactionHistoryBaseItemSchema
    .extend({
      kind: z.literal("unattributed"),
      /**
       * No entity relation on the ledger row, so the only source signal left is
       * the credit bucket the spend drew from. Reported rather than guessed:
       * inventing an attribution here would be worse than an honest blank.
       */
      bucketSource: z.string().nullable().openapi({
        description:
          "Credit bucket the spend drew from, when a consumption row records one. Null when nothing about the source is known.",
        example: "STRIPE_SUBSCRIPTION_PERIOD",
      }),
    })
    .openapi("TransactionHistoryUnattributedItem");

export const transactionHistoryItemSchema = z
  .discriminatedUnion("kind", [
    transactionHistoryJobItemSchema,
    transactionHistoryImageItemSchema,
    transactionHistoryTaskItemSchema,
    transactionHistoryCoworkerItemSchema,
    transactionHistorySokoBotItemSchema,
    transactionHistoryUnattributedItemSchema,
  ])
  .openapi("TransactionHistoryItem");

export const transactionHistoryListSchema = z
  .array(transactionHistoryItemSchema)
  .openapi("TransactionHistoryList");

export const transactionHistoryListResponseExample = {
  data: [
    {
      kind: "job",
      id: "01960001-0001-7001-8001-000000000001",
      title: "Research competitors",
      description: "Research Agent",
      credits: 5,
      consumedAt: "2026-01-21T11:30:00.000Z",
      projectId: null,
      jobId: "job_123",
      agentId: "agent_123",
      agentName: "Research Agent",
      agentIcon: "https://example.com/research.svg",
      owner: {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        name: "Bob Smith",
        image: null,
      },
    },
    {
      kind: "unattributed",
      id: "01960001-0001-7001-8001-000000000002",
      title: "Credit consumption",
      description: null,
      credits: 12,
      consumedAt: "2026-08-31T09:12:00.000Z",
      projectId: null,
      bucketSource: "STRIPE_SUBSCRIPTION_PERIOD",
      owner: {
        userId: "550e8400-e29b-41d4-a716-446655440002",
        name: "Bob Smith",
        image: null,
      },
    },
  ],
  meta: {
    timestamp: "2026-01-21T12:00:00.000Z",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    pagination: {
      cursor: null,
      limit: 20,
      total: 200,
      nextCursor: "01960001-0001-7001-8001-000000000002",
    },
  },
};

export type TransactionHistoryItem = z.infer<
  typeof transactionHistoryItemSchema
>;
export type TransactionHistoryKind = (typeof transactionHistoryKinds)[number];

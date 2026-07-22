import { z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { dateTimeSchema } from "@/helpers/datetime";
import { taskStatusSchema } from "@/schemas/domain-enums.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { taskSchema } from "@/schemas/task.schema";

const developerCoworkerRefSchema = z
  .object({
    id: z.string().openapi({ example: "cow_123" }),
    name: z.string().openapi({ example: "Ops Agent" }),
    slug: z.string().openapi({ example: "ops-agent" }),
  })
  .openapi("DeveloperCoworkerRef");

const developerTaskOwnerSchema = z.object({
  id: z.string().openapi({ example: "user_123" }),
  name: z.string().openapi({ example: "Ada Lovelace" }),
  email: z.string().openapi({ example: "ada@example.com" }),
});

const developerOrganizationRefSchema = z
  .object({
    id: z.string().openapi({ example: "org_123" }),
    name: z.string().openapi({ example: "Acme Corp" }),
    slug: z.string().openapi({ example: "acme-corp" }),
  })
  .nullable();

export const developerTaskListQuerySchema = z
  .object({
    coworkerId: z
      .string()
      .optional()
      .openapi({
        param: { name: "coworkerId", in: "query" },
        description:
          "Optional filter to tasks where this owned coworker is assignee or creator. Must be owned by the caller.",
        example: "cow_123",
      }),
  })
  .extend(cursorPaginationQuerySchema.shape);

export const developerTaskListItemSchema = z
  .object({
    id: z.string().openapi({ example: "0195b9f4-7d35-7a4e-b14e-111111111111" }),
    name: z.string().openapi({ example: "Quarterly report" }),
    status: taskStatusSchema.openapi({ example: TaskStatus.RUNNING }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    assignee: developerCoworkerRefSchema.nullable(),
    creatorCoworker: developerCoworkerRefSchema.nullable(),
    owner: developerTaskOwnerSchema,
    organization: developerOrganizationRefSchema,
  })
  .openapi("DeveloperTaskListItem");

export const developerTaskListSchema = z.array(developerTaskListItemSchema);

export const developerTaskIdParamSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "0195b9f4-7d35-7a4e-b14e-111111111111",
  }),
});

export const developerTaskDetailSchema = z
  .object({
    task: taskSchema,
    owner: developerTaskOwnerSchema,
    organization: developerOrganizationRefSchema,
  })
  .openapi("DeveloperTaskDetail");

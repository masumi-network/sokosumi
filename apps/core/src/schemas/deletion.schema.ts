import { z } from "@hono/zod-openapi";

import {
  ORGANIZATION_DELETION_BLOCKER_CODES,
  USER_DELETION_BLOCKER_CODES,
} from "@/helpers/deletion-evaluate";

export const userDeletionEvaluationSchema = z
  .object({
    blockers: z.array(z.enum(USER_DELETION_BLOCKER_CODES)).openapi({
      description:
        "Current User-deletion blockers. Empty means the existing wipe may proceed.",
      example: ["TASK_PAYMENT_CLAIM_PENDING"],
    }),
  })
  .openapi("UserDeletionEvaluation");

export const organizationDeletionEvaluationSchema = z
  .object({
    blockers: z.array(z.enum(ORGANIZATION_DELETION_BLOCKER_CODES)).openapi({
      description:
        "Current Organization-deletion blockers. Empty means the existing wipe may proceed.",
      example: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS"],
    }),
  })
  .openapi("OrganizationDeletionEvaluation");

import { z } from "@hono/zod-openapi";

import { WORKSPACE_GATE_STATUSES } from "@/helpers/workspace-gate";

export const workspaceGateStatusSchema = z
  .enum(WORKSPACE_GATE_STATUSES)
  .openapi("WorkspaceGateStatus", {
    description:
      "Derived workspace gate: ready when the user has a personal workspace or any organization membership; pending-invites when they have neither but have non-expired pending organization invitations; identity-onboarding when they have neither and no pending org entry",
    example: "ready",
  });

export const workspaceGateSchema = z
  .object({
    gate: workspaceGateStatusSchema,
    hasPersonalWorkspace: z.boolean().openapi({
      description: "Whether the user owns a personal workspace row",
      example: true,
    }),
    hasOrganizationMembership: z.boolean().openapi({
      description: "Whether the user is a member of at least one organization",
      example: false,
    }),
    hasPendingOrganizationInvites: z.boolean().openapi({
      description:
        "Whether the user has at least one non-expired pending organization invitation by email",
      example: false,
    }),
  })
  .openapi("WorkspaceGate");

export type WorkspaceGateResponse = z.infer<typeof workspaceGateSchema>;

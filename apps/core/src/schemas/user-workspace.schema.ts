import { z } from "@hono/zod-openapi";
import { normalizeWebsiteUrl } from "@sokosumi/utils";

const USER_WORKSPACE_KINDS = ["personal", "organization"] as const;

export const userWorkspaceSchema = z
  .object({
    id: z.uuid().openapi({
      description: "Workspace id",
      example: "11111111-1111-7111-8111-111111111111",
    }),
    kind: z.enum(USER_WORKSPACE_KINDS).openapi({
      description:
        "Whether the person owns the workspace or acts in it as an organization member",
      example: "organization",
    }),
    name: z.string().openapi({
      description:
        "The person's name for a personal workspace, the organization's name otherwise",
      example: "Acme",
    }),
    organizationId: z.string().nullable().openapi({
      description: "Organization id, or null for a personal workspace",
      example: "org_123",
    }),
    slug: z.string().nullable().openapi({
      description: "Organization slug, or null for a personal workspace",
      example: "acme-x1y2z3",
    }),
    logo: z.string().nullable().openapi({
      description:
        "Organization logo URL (or IPFS reference), or null for none and for a personal workspace",
      example: "https://cdn.example.com/acme.png",
    }),
    websiteUrl: z.string().nullable().openapi({
      description:
        "Organization website from its metadata, or null for none and for a personal workspace",
      example: "https://acme.com",
    }),
    preferred: z.boolean().openapi({
      description: "Whether a new session opens this workspace",
      example: true,
    }),
  })
  .openapi("UserWorkspace");

export const userWorkspacesSchema = z
  .object({
    workspaces: z.array(userWorkspaceSchema).openapi({
      description:
        "Workspaces the person can act in: their personal workspace first, then their organizations. Exactly one is `preferred` whenever the list is non-empty. Empty means the person still needs identity onboarding",
    }),
    pendingInvitationCount: z.number().int().nonnegative().openapi({
      description:
        "Non-expired pending organization invitations for the person's email",
      example: 0,
    }),
  })
  .openapi("UserWorkspaces");

const websiteUrlSchema = z
  .string()
  .trim()
  .refine((value) => normalizeWebsiteUrl(value) !== null, {
    error: "Enter a valid website URL",
  })
  .openapi({
    description: "The organization's website. `https://` is added when missing",
    example: "acme.com",
  });

export const createUserWorkspaceSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("personal") }),
    z.object({
      kind: z.literal("organization"),
      name: z.string().trim().min(2).max(50).openapi({
        description: "Organization name",
        example: "Acme",
      }),
      websiteUrl: websiteUrlSchema,
    }),
  ])
  .openapi("CreateUserWorkspace");

export const setPreferredUserWorkspaceSchema = z
  .object({
    workspaceId: z.uuid().openapi({
      description: "Id of a workspace the person can act in",
      example: "11111111-1111-7111-8111-111111111111",
    }),
  })
  .openapi("SetPreferredUserWorkspace");

export type UserWorkspace = z.infer<typeof userWorkspaceSchema>;
export type UserWorkspaces = z.infer<typeof userWorkspacesSchema>;

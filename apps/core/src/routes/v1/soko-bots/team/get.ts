import { createRoute } from "@hono/zod-openapi";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  avatarFields,
  avatarStateRelations,
} from "@/helpers/soko-bot-avatar-state";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { sokoBotTeamSchema } from "@/schemas/soko-bot.schema";

const botTeamSelect = () =>
  ({
    id: true,
    name: true,
    avatarImageUrl: true,
    avatarSeed: true,
    status: true,
    lastActivityAt: true,
    archivedAt: true,
    adminPausedAt: true,
    ...avatarStateRelations(),
  }) as const;

const teamRoute = createRoute({
  method: "get",
  path: "/team",
  operationId: "getSokoBotTeam",
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotTeamSchema,
      "People in the current workspace and their Soko Bots",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(teamRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    const userSelect = {
      id: true,
      name: true,
      image: true,
      sokoBots: {
        where: { workspaceId: workspace.workspaceId, archivedAt: null },
        take: 1,
        select: botTeamSelect(),
      },
    } as const;
    const mapBotForTeam = (
      bot: Parameters<typeof avatarFields>[0] & {
        id: string;
        name: string | null;
        avatarSeed: string | null;
        lastActivityAt: Date | null;
      },
    ) =>
      bot.archivedAt
        ? null
        : {
            id: bot.id,
            name: bot.name,
            avatarImageUrl: bot.avatarImageUrl,
            ...avatarFields(bot),
            avatarSeed: bot.avatarSeed,
            status: bot.status,
            lastActivityAt: bot.lastActivityAt,
          };
    if (workspace.organizationId) {
      const organization = await prisma.organization.findUnique({
        where: { id: workspace.organizationId },
        select: {
          name: true,
          logo: true,
          members: {
            orderBy: { createdAt: "asc" },
            select: { role: true, user: { select: userSelect } },
          },
        },
      });
      if (!organization) throw notFound("Organization not found");
      return ok(
        c,
        sokoBotTeamSchema.parse({
          workspace: {
            id: workspace.workspaceId,
            kind: "organization",
            name: organization.name,
            logo: organization.logo,
          },
          members: organization.members.map((member) => ({
            userId: member.user.id,
            name: member.user.name,
            image: member.user.image,
            role: member.role,
            isYou: member.user.id === auth.userId,
            bot: member.user.sokoBots[0]
              ? mapBotForTeam(member.user.sokoBots[0])
              : null,
          })),
        }),
      );
    }
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: userSelect,
    });
    if (!user) throw notFound("User not found");
    return ok(
      c,
      sokoBotTeamSchema.parse({
        workspace: {
          id: workspace.workspaceId,
          kind: "personal",
          name: user.name,
          logo: user.image,
        },
        members: [
          {
            userId: user.id,
            name: user.name,
            image: user.image,
            role: null,
            isYou: true,
            bot: user.sokoBots[0] ? mapBotForTeam(user.sokoBots[0]) : null,
          },
        ],
      }),
    );
  });
}

import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import {
  memberRepository,
  organizationInviteLinkRepository,
} from "@sokosumi/database/repositories";
import { evaluateInviteLinkStatus } from "@sokosumi/utils";

import { upgradeGuestChatRoomMembershipsToMember } from "@/helpers/chat-room-guest-upgrade";
import { badRequest, notFound } from "@/helpers/error";
import { cancelPendingOrganizationInvitationsForUser } from "@/helpers/invitation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ensurePersonalWorkspaceForOrganizationMembership } from "@/helpers/org-membership-personal-workspace";
import { isMemberUserOrganizationUniqueConstraintError } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { acceptOrganizationInviteLinkResponseSchema } from "@/schemas/organization-invite-link.schema";

const params = z.object({
  token: z.string().openapi({
    param: { name: "token", in: "path" },
    description: "Invite link capability token from the /join URL",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{token}/accept",
  description:
    "Join an organization via a shareable invite link. The signed-in caller is added as a member, subject to the same billing seat gate as a normal invitation accept. Idempotent: an existing member returns `already_member`. Rejects expired / revoked / depleted links.",
  tags: ["Organization Invite Links"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      acceptOrganizationInviteLinkResponseSchema,
      "Joined, or already a member",
    ),
    400: jsonErrorResponse("Bad Request - link expired, revoked, or depleted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - session user required (coworker rejected)",
    ),
    404: jsonErrorResponse("Not Found - invalid link or organization"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only: joining an org via a link is a self-service consent
    // action, so a coworker key with X-Context-User-Id must not
    // be able to enroll an arbitrary user.
    const userContext = requireUserAuthContext(c.var.authContext);
    const { token } = c.req.valid("param");
    const now = new Date();

    const link = await organizationInviteLinkRepository.getInviteLinkByToken(
      token,
      prisma,
    );
    const status = evaluateInviteLinkStatus(link, now);
    if (!link || status === "not_found") {
      throw notFound("This invite link is not valid.");
    }
    if (status !== "valid") {
      throw badRequest(
        status === "expired"
          ? "This invite link has expired."
          : status === "revoked"
            ? "This invite link has been revoked."
            : "This invite link has reached its usage limit.",
      );
    }

    const organizationId = link.organizationId;
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });
    if (!organization) {
      throw notFound("Organization not found.");
    }

    let outcome: "joined" | "already_member" | "depleted";
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const existing =
          await memberRepository.getMemberByUserIdAndOrganizationId(
            userContext.userId,
            organizationId,
            tx,
          );
        if (existing) {
          await cancelPendingOrganizationInvitationsForUser(
            userContext.userId,
            organizationId,
            tx,
          );
          return "already_member";
        }

        // Atomically reserve a use; false when the link died concurrently.
        const consumed =
          await organizationInviteLinkRepository.tryConsumeInviteLink(
            { id: link.id, now, maxUses: link.maxUses },
            tx,
          );
        if (!consumed) return "depleted";

        await ensurePersonalWorkspaceForOrganizationMembership(
          userContext.userId,
          { tx, organizationId },
        );

        await memberRepository.createMember(
          userContext.userId,
          organizationId,
          MemberRole.MEMBER,
          tx,
        );
        await upgradeGuestChatRoomMembershipsToMember(
          userContext.userId,
          organizationId,
          tx,
        );
        await cancelPendingOrganizationInvitationsForUser(
          userContext.userId,
          organizationId,
          tx,
        );
        return "joined";
      });
    } catch (error) {
      // Concurrent join inserted the membership first; the failing tx rolled
      // back its own consume, so we simply report already_member. Do not treat
      // a personal-workspace unique on userId as already_member.
      if (isMemberUserOrganizationUniqueConstraintError(error)) {
        await cancelPendingOrganizationInvitationsForUser(
          userContext.userId,
          organizationId,
          prisma,
        );
        outcome = "already_member";
      } else {
        throw error;
      }
    }

    if (outcome === "depleted") {
      throw badRequest("This invite link has reached its usage limit.");
    }

    return ok(
      c,
      acceptOrganizationInviteLinkResponseSchema.parse({
        status: outcome === "joined" ? "joined" : "already_member",
        organizationSlug: organization.slug,
        organizationId,
      }),
    );
  });
}

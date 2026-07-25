import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import {
  memberRepository,
  organizationInviteLinkRepository,
} from "@sokosumi/database/repositories";

import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { evaluateInviteLinkStatus } from "@/helpers/organization-invite-link";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { acceptOrganizationInviteLinkResponseSchema } from "@/schemas/organization-invite-link.schema";
import {
  ensureCanAcceptOrganizationInvitation,
  syncLocalFreeSeatsAndCreditsForCurrentMembers,
} from "@/services/organization-subscription-auth.service";

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
    404: jsonErrorResponse("Not Found - invalid link or organization"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
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

    // Billing seat gate — identical to a normal invitation accept, so a link
    // can never sneak a member past the org's plan limits.
    await ensureCanAcceptOrganizationInvitation(organizationId);

    let outcome: "joined" | "already_member" | "depleted";
    try {
      outcome = await prisma.$transaction(async (tx) => {
        const existing =
          await memberRepository.getMemberByUserIdAndOrganizationId(
            userContext.userId,
            organizationId,
            tx,
          );
        if (existing) return "already_member";

        // Atomically reserve a use; false when the link died concurrently.
        const consumed =
          await organizationInviteLinkRepository.tryConsumeInviteLink(
            { id: link.id, now, maxUses: link.maxUses },
            tx,
          );
        if (!consumed) return "depleted";

        await memberRepository.createMember(
          userContext.userId,
          organizationId,
          MemberRole.MEMBER,
          tx,
        );
        return "joined";
      });
    } catch (error) {
      // Concurrent join inserted the membership first; the failing tx rolled
      // back its own consume, so we simply report already_member.
      if (isPrismaUniqueViolation(error)) {
        outcome = "already_member";
      } else {
        throw error;
      }
    }

    if (outcome === "depleted") {
      throw badRequest("This invite link has reached its usage limit.");
    }

    if (outcome === "joined") {
      // Keep local free-seat + credit accounting in step with the new member,
      // exactly as the normal invitation-accept hook does.
      await syncLocalFreeSeatsAndCreditsForCurrentMembers(organizationId);
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

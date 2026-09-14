import * as Sentry from "@sentry/node";
import { ensureInitialLocalFreeSubscriptionPeriod } from "@sokosumi/database/helpers";
import { workspaceRepository } from "@sokosumi/database/repositories";
import { renderOrganizationInvitationEmail } from "@sokosumi/email";
import {
  betterAuthOrganizationAdditionalFields,
  getEmailLocale,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";
import { organization } from "better-auth/plugins";
import { sendEmail } from "@/clients/email.client";
import { stripeClient } from "@/clients/stripe.client";
import { LIMITS, TIME } from "@/config/constants";
import { getWebAppBaseUrl } from "@/config/env";
import { deliverOrganizationCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { upgradeGuestChatRoomMembershipsToMember } from "@/helpers/chat-room-guest-upgrade";
import {
  listOrganizationExitChatRoomIdsForAbly,
  publishOrganizationExitChatRevocation,
} from "@/helpers/chat-room-organization-exit";
import {
  applyDesignMdMetadataGuardToOrganizationCreate,
  applyDesignMdMetadataGuardToOrganizationUpdate,
} from "@/helpers/design-md-metadata-auth";
import {
  ensurePersonalWorkspaceForOrganizationMembership,
  pinPreferredOrganizationIfUnset,
} from "@/helpers/org-membership-personal-workspace";
import { prepareOrganizationForDeletion } from "@/helpers/organization-deletion";
import { deleteStripeCustomerBestEffort } from "@/helpers/stripe-customer-delete";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";

async function ensureWorkspaceForCreatedOrganization(organization: {
  id: string;
  name: string;
}): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await workspaceRepository.upsertOrganizationWorkspace({
        organizationId: organization.id,
        tx,
      });
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        context: "workspace_organization_creation",
      },
      extra: {
        organizationId: organization.id,
        organizationName: organization.name,
      },
    });
  }
}

async function ensureStripeCustomerForCreatedOrganization(organization: {
  id: string;
  name: string;
  slug: string;
}): Promise<void> {
  await stripeClient.createOrganizationCustomer({
    organizationId: organization.id,
    slug: organization.slug,
    name: organization.name,
  });
}

/**
 * Seeds the local free subscription (and its member credit grants) the moment
 * an organization exists. Previously this only happened when Stripe's
 * customer.created webhook arrived, so a freshly created organization had no
 * credits and rejected invitation accepts ("An active organization
 * subscription is required") until the webhook round-trip completed — a race
 * the create-organization wizard hits every time because it invites members
 * seconds after creation. The webhook re-runs the same idempotent ensure
 * later, finding this period and creating nothing.
 */
async function ensureFreeSubscriptionForCreatedOrganization(organization: {
  id: string;
  name: string;
  createdAt: Date;
}): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await ensureInitialLocalFreeSubscriptionPeriod(
        {
          createdAt: organization.createdAt,
          kind: "organization",
          organizationId: organization.id,
          stripeCustomerId: null,
        },
        tx,
      );
    });
  } catch (error) {
    // Fail soft: the customer.created webhook still seeds it as a fallback.
    Sentry.captureException(error, {
      tags: {
        context: "organization_free_subscription_seed",
      },
      extra: {
        organizationId: organization.id,
        organizationName: organization.name,
      },
    });
  }
}

export function createAuthOrganizationPlugin() {
  const webAppBaseUrl = getWebAppBaseUrl();

  return organization({
    organizationHooks: {
      beforeCreateOrganization: async ({ organization, user }) => {
        await ensurePersonalWorkspaceForOrganizationMembership(user.id);
        return {
          data: applyDesignMdMetadataGuardToOrganizationCreate(
            organization as Record<string, unknown>,
          ),
        };
      },
      afterCreateOrganization: async ({ organization, user }) => {
        await ensureWorkspaceForCreatedOrganization(organization);
        await pinPreferredOrganizationIfUnset(user.id, organization.id);
        await ensureFreeSubscriptionForCreatedOrganization(organization);
        void ensureStripeCustomerForCreatedOrganization(organization).catch(
          (error) => {
            Sentry.captureException(error, {
              tags: {
                context: "stripe_organization_customer_creation",
              },
              extra: {
                organizationId: organization.id,
                organizationName: organization.name,
                organizationSlug: organization.slug,
              },
            });
          },
        );
      },
      beforeUpdateOrganization: async ({ organization, member }) => {
        return {
          data: await applyDesignMdMetadataGuardToOrganizationUpdate(
            organization as Record<string, unknown>,
            member.organizationId,
          ),
        };
      },
      beforeAcceptInvitation: async ({ organization, user }) => {
        await ensurePersonalWorkspaceForOrganizationMembership(user.id, {
          organizationId: organization.id,
        });
      },
      beforeAddMember: async ({ user, organization }) => {
        await ensurePersonalWorkspaceForOrganizationMembership(user.id, {
          organizationId: organization.id,
        });
      },
      afterAcceptInvitation: async ({ organization, user }) => {
        await upgradeGuestChatRoomMembershipsToMember(user.id, organization.id);
      },
      afterAddMember: async ({ organization, user }) => {
        await upgradeGuestChatRoomMembershipsToMember(user.id, organization.id);
      },
      // BA leaveOrganization has no remove-member hooks — durable hard-leave
      // for leave (and for remove) is the member-delete DB trigger. For
      // remove-member only: snapshot room IDs on the member object BA passes
      // to both hooks (no module Map), then Ably-revoke after Member is gone.
      beforeRemoveMember: async ({ organization, user, member }) => {
        const roomIds = await listOrganizationExitChatRoomIdsForAbly(
          user.id,
          organization.id,
        );
        // BA reuses the same member object for afterRemoveMember.
        (
          member as { organizationExitChatRoomIds?: string[] }
        ).organizationExitChatRoomIds = roomIds;
      },
      afterRemoveMember: async ({ organization, user, member }) => {
        const roomIds =
          (member as { organizationExitChatRoomIds?: string[] })
            .organizationExitChatRoomIds ?? [];
        await Promise.all([
          publishOrganizationExitChatRevocation(user.id, {
            revokedRoomIds: roomIds,
            statusMessages: [],
          }),
          deliverOrganizationCalendarInvalidationsNow(organization.id, user.id),
        ]);
      },
      beforeDeleteOrganization: async ({ organization, user }) => {
        organization.stripeCustomerId = await prepareOrganizationForDeletion(
          organization.id,
          user.id,
          prisma,
        );
      },
      afterDeleteOrganization: async ({ organization }) => {
        waitUntil(
          deleteStripeCustomerBestEffort({
            stripeCustomerId: organization.stripeCustomerId,
            ownerType: "organization",
            ownerId: organization.id,
          }),
        );
      },
    },
    schema: {
      organization: {
        additionalFields: betterAuthOrganizationAdditionalFields,
      },
    },
    async sendInvitationEmail(data, request) {
      const inviteLink = `${webAppBaseUrl}/accept-invitation/${data.id}`;
      const email = await renderOrganizationInvitationEmail({
        invitationLink: inviteLink,
        invitorUsername: data.inviter.user.name,
        locale: getEmailLocale(request),
        organizationName: data.organization.name,
      });

      waitUntil(
        sendEmail({
          to: data.email,
          tag: "invitation-email",
          subject: email.subject,
          html: email.html,
        }).catch((error) => {
          captureExternalServiceError(error, {
            label: "organization_invitation_email",
            sentry: {
              tags: {
                context: "organization_invitation_email",
              },
            },
            extra: {
              invitationId: data.id,
              organizationId: data.organization.id,
            },
          });
        }),
      );
    },
    invitationLimit: LIMITS.ORGANIZATION_INVITATION_LIMIT,
    cancelPendingInvitationsOnReInvite: true,
    allowUserToCreateOrganization: true,
    organizationLimit: LIMITS.ORGANIZATION_LIMIT,
    invitationExpiresIn: TIME.INVITATION_EXPIRES,
  });
}

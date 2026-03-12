import { Text } from "@react-email/text";
import type { ReactNode } from "react";

import { renderActionEmail } from "../templates/action-email.js";
import type {
  MagicLinkEmailProps,
  OrganizationInvitationEmailProps,
  RenderedEmail,
  ResetPasswordEmailProps,
  VerificationEmailProps,
} from "../types.js";

function formatHelloGreeting(name?: string): string {
  const trimmedName = name?.trim();
  return trimmedName ? `Hello ${trimmedName}` : "Hello";
}

interface RenderAuthActionEmailOptions {
  actionUrl: string;
  actionLabel: string;
  body: string;
  extraContent?: ReactNode;
  footer: string;
  greeting?: string;
  name?: string;
  subject: string;
  title: string;
}

function renderAuthActionEmail({
  actionUrl,
  actionLabel,
  body,
  extraContent,
  footer,
  greeting,
  name,
  subject,
  title,
}: RenderAuthActionEmailOptions): Promise<RenderedEmail> {
  return renderActionEmail({
    actionLabel,
    actionUrl,
    body,
    extraContent,
    footer,
    greeting: greeting ?? formatHelloGreeting(name),
    preview: subject,
    subject,
    title,
  });
}

export async function renderVerificationEmail({
  name,
  verificationLink,
}: VerificationEmailProps): Promise<RenderedEmail> {
  return renderAuthActionEmail({
    actionUrl: verificationLink,
    actionLabel: "Verify email",
    body: "Please verify your email address by clicking the button below. This helps us ensure the security of your account.",
    footer:
      "If you didn't create an account, you can safely ignore this email.",
    name,
    subject: "Sokosumi - Verify your email address",
    title: "Verify your email address",
  });
}

export async function renderResetPasswordEmail({
  name,
  resetLink,
}: ResetPasswordEmailProps): Promise<RenderedEmail> {
  return renderAuthActionEmail({
    actionUrl: resetLink,
    actionLabel: "Reset password",
    body: "We received a request to reset your password for your account. If you didn't make this request, you can safely ignore this email.",
    footer:
      "If you didn't request a password reset, please ignore this email or contact support if you have concerns.",
    name,
    subject: "Sokosumi - Reset your password",
    title: "Reset your password",
  });
}

export async function renderMagicLinkEmail({
  magicLink,
  name,
  token,
}: MagicLinkEmailProps): Promise<RenderedEmail> {
  return renderAuthActionEmail({
    actionUrl: magicLink,
    actionLabel: "Sign in",
    body: "Use the button below to sign in to your Sokosumi account.",
    extraContent: token ? (
      <>
        <Text className="m-0 mb-[12px] text-[14px] leading-[24px] text-black">
          If you need it, you can also use this one-time token:
        </Text>
        <Text className="m-0 mb-[26px] inline-block break-all rounded border border-solid border-[#eaeaea] bg-[#f8f8f8] px-[14px] py-[12px] font-mono text-[14px] leading-[20px] text-black">
          {token}
        </Text>
      </>
    ) : undefined,
    footer:
      "If you didn't request this email, you can safely ignore this email.",
    name,
    subject: "Sokosumi - Sign in to your account",
    title: "Sign in to Sokosumi",
  });
}

export async function renderOrganizationInvitationEmail({
  invitationLink,
  invitorUsername,
  organizationName,
}: OrganizationInvitationEmailProps): Promise<RenderedEmail> {
  return renderAuthActionEmail({
    actionUrl: invitationLink,
    actionLabel: "Accept Invitation",
    body: `You've been invited to join ${organizationName} on Sokosumi. Click the button below to accept the invitation.`,
    footer:
      "If you didn't request this invitation, you can safely ignore this email.",
    greeting: "Hello there",
    subject: "Sokosumi - Organization Invitation",
    title: `Join ${invitorUsername} on ${organizationName}`,
  });
}

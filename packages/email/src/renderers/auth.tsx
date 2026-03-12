import { render } from "@react-email/render";
import { Text } from "@react-email/text";

import { ActionEmailTemplate } from "../templates/action-email.js";
import type {
  MagicLinkEmailProps,
  OrganizationInvitationEmailProps,
  RenderedEmail,
  ResetPasswordEmailProps,
  VerificationEmailProps,
} from "../types.js";

const VERIFICATION_EMAIL = {
  button: "Verify email",
  footer: "If you didn't create an account, you can safely ignore this email.",
  linkInstructions: "Or copy and paste this URL into your browser:",
  message:
    "Please verify your email address by clicking the button below. This helps us ensure the security of your account.",
  subject: "Sokosumi - Verify your email address",
  title: "Verify your email address",
} as const;

const RESET_PASSWORD_EMAIL = {
  button: "Reset password",
  footer:
    "If you didn't request a password reset, please ignore this email or contact support if you have concerns.",
  linkInstructions: "Or copy and paste this URL into your browser:",
  message:
    "We received a request to reset your password for your account. If you didn't make this request, you can safely ignore this email.",
  subject: "Sokosumi - Reset your password",
  title: "Reset your password",
} as const;

const MAGIC_LINK_EMAIL = {
  button: "Sign in",
  footer: "If you didn't request this email, you can safely ignore this email.",
  greetingAnonymous: "Hello",
  linkInstructions: "Or copy and paste this URL into your browser:",
  message: "Use the button below to sign in to your Sokosumi account.",
  subject: "Sokosumi - Sign in to your account",
  title: "Sign in to Sokosumi",
  tokenInstructions: "If you need it, you can also use this one-time token:",
} as const;

const ORGANIZATION_INVITATION_EMAIL = {
  button: "Accept Invitation",
  footer:
    "If you didn't request this invitation, you can safely ignore this email.",
  greeting: "Hello there",
  linkInstructions: "Or copy and paste this URL into your browser:",
  subject: "Sokosumi - Organization Invitation",
} as const;

function formatHelloGreeting(name?: string): string {
  const trimmedName = name?.trim();
  return trimmedName ? `Hello ${trimmedName}` : MAGIC_LINK_EMAIL.greetingAnonymous;
}

export async function renderVerificationEmail({
  name,
  verificationLink,
}: VerificationEmailProps): Promise<RenderedEmail> {
  const subject = VERIFICATION_EMAIL.subject;
  const html = await render(
    <ActionEmailTemplate
      actionLabel={VERIFICATION_EMAIL.button}
      actionUrl={verificationLink}
      body={VERIFICATION_EMAIL.message}
      footer={VERIFICATION_EMAIL.footer}
      greeting={formatHelloGreeting(name)}
      linkInstructions={VERIFICATION_EMAIL.linkInstructions}
      preview={subject}
      title={VERIFICATION_EMAIL.title}
    />,
  );

  return { html, subject };
}

export async function renderResetPasswordEmail({
  name,
  resetLink,
}: ResetPasswordEmailProps): Promise<RenderedEmail> {
  const subject = RESET_PASSWORD_EMAIL.subject;
  const html = await render(
    <ActionEmailTemplate
      actionLabel={RESET_PASSWORD_EMAIL.button}
      actionUrl={resetLink}
      body={RESET_PASSWORD_EMAIL.message}
      footer={RESET_PASSWORD_EMAIL.footer}
      greeting={formatHelloGreeting(name)}
      linkInstructions={RESET_PASSWORD_EMAIL.linkInstructions}
      preview={subject}
      title={RESET_PASSWORD_EMAIL.title}
    />,
  );

  return { html, subject };
}

export async function renderMagicLinkEmail({
  magicLink,
  name,
  token,
}: MagicLinkEmailProps): Promise<RenderedEmail> {
  const subject = MAGIC_LINK_EMAIL.subject;
  const html = await render(
    <ActionEmailTemplate
      actionLabel={MAGIC_LINK_EMAIL.button}
      actionUrl={magicLink}
      body={MAGIC_LINK_EMAIL.message}
      extraContent={
        token ? (
          <>
            <Text className="m-0 mb-[12px] text-[14px] leading-[24px] text-black">
              {MAGIC_LINK_EMAIL.tokenInstructions}
            </Text>
            <Text className="m-0 mb-[26px] inline-block break-all rounded border border-solid border-[#eaeaea] bg-[#f8f8f8] px-[14px] py-[12px] font-mono text-[14px] leading-[20px] text-black">
              {token}
            </Text>
          </>
        ) : undefined
      }
      footer={MAGIC_LINK_EMAIL.footer}
      greeting={formatHelloGreeting(name)}
      linkInstructions={MAGIC_LINK_EMAIL.linkInstructions}
      preview={subject}
      title={MAGIC_LINK_EMAIL.title}
    />,
  );

  return { html, subject };
}

export async function renderOrganizationInvitationEmail({
  invitationLink,
  invitorUsername,
  organizationName,
}: OrganizationInvitationEmailProps): Promise<RenderedEmail> {
  const subject = ORGANIZATION_INVITATION_EMAIL.subject;
  const html = await render(
    <ActionEmailTemplate
      actionLabel={ORGANIZATION_INVITATION_EMAIL.button}
      actionUrl={invitationLink}
      body={`You've been invited to join ${organizationName} on Sokosumi. Click the button below to accept the invitation.`}
      footer={ORGANIZATION_INVITATION_EMAIL.footer}
      greeting={ORGANIZATION_INVITATION_EMAIL.greeting}
      linkInstructions={ORGANIZATION_INVITATION_EMAIL.linkInstructions}
      preview={subject}
      title={`Join ${invitorUsername} on ${organizationName}`}
    />,
  );

  return { html, subject };
}

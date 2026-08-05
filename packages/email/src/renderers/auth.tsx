import { createEmailTranslator } from "../i18n/translate.js";
import { renderActionEmail } from "../templates/action-email.js";
import type {
  ChatRoomInvitationEmailProps,
  MagicLinkEmailProps,
  OrganizationInvitationEmailProps,
  RenderedEmail,
  ResetPasswordEmailProps,
  VerificationEmailProps,
} from "../types.js";

type TranslateFn = ReturnType<typeof createEmailTranslator>["t"];

function formatGreeting(t: TranslateFn, key: string, name?: string): string {
  const trimmedName = name?.trim();

  if (trimmedName) {
    return t(key, { name: trimmedName });
  }

  return t(key, { name: "" }).trimEnd();
}

interface RenderAuthActionEmailOptions {
  actionUrl: string;
  actionLabel: string;
  body: string;
  footer: string;
  greeting?: string;
  linkInstructions?: string;
  subject: string;
  title: string;
}

function renderAuthActionEmail({
  actionUrl,
  actionLabel,
  body,
  footer,
  greeting,
  linkInstructions,
  subject,
  title,
}: RenderAuthActionEmailOptions): Promise<RenderedEmail> {
  return renderActionEmail({
    actionLabel,
    actionUrl,
    body,
    footer,
    greeting: greeting ?? "",
    linkInstructions,
    preview: subject,
    subject,
    title,
  });
}

export async function renderVerificationEmail({
  locale,
  name,
  verificationLink,
}: VerificationEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderAuthActionEmail({
    actionUrl: verificationLink,
    actionLabel: t("auth.verification.button"),
    body: t("auth.verification.message"),
    footer: t("auth.verification.footer"),
    greeting: formatGreeting(t, "auth.verification.greeting", name),
    linkInstructions: t("auth.verification.linkInstructions"),
    subject: t("auth.verification.subject"),
    title: t("auth.verification.title"),
  });
}

export async function renderResetPasswordEmail({
  locale,
  name,
  resetLink,
}: ResetPasswordEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderAuthActionEmail({
    actionUrl: resetLink,
    actionLabel: t("auth.resetPassword.button"),
    body: t("auth.resetPassword.message"),
    footer: t("auth.resetPassword.footer"),
    greeting: formatGreeting(t, "auth.resetPassword.greeting", name),
    linkInstructions: t("auth.resetPassword.linkInstructions"),
    subject: t("auth.resetPassword.subject"),
    title: t("auth.resetPassword.title"),
  });
}

export async function renderMagicLinkEmail({
  locale,
  magicLink,
  name,
}: MagicLinkEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderAuthActionEmail({
    actionUrl: magicLink,
    actionLabel: t("auth.magicLink.button"),
    body: t("auth.magicLink.message"),
    footer: t("auth.magicLink.footer"),
    greeting: name?.trim()
      ? t("auth.magicLink.greeting", { name: name.trim() })
      : t("auth.magicLink.greetingAnonymous"),
    linkInstructions: t("auth.magicLink.linkInstructions"),
    subject: t("auth.magicLink.subject"),
    title: t("auth.magicLink.title"),
  });
}

export async function renderOrganizationInvitationEmail({
  invitationLink,
  invitorUsername,
  locale,
  organizationName,
}: OrganizationInvitationEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderAuthActionEmail({
    actionUrl: invitationLink,
    actionLabel: t("auth.invitation.button"),
    body: t("auth.invitation.message", { organizationName }),
    footer: t("auth.invitation.footer"),
    greeting: t("auth.invitation.greeting"),
    linkInstructions: t("auth.invitation.linkInstructions"),
    subject: t("auth.invitation.subject"),
    title: t("auth.invitation.title", { invitorUsername, organizationName }),
  });
}

export async function renderChatRoomInvitationEmail({
  channelName,
  invitationLink,
  invitorUsername,
  locale,
  organizationName,
}: ChatRoomInvitationEmailProps): Promise<RenderedEmail> {
  const { t } = createEmailTranslator(locale);

  return renderAuthActionEmail({
    actionUrl: invitationLink,
    actionLabel: t("chat.invitation.button"),
    body: t("chat.invitation.message", {
      channelName,
      invitorUsername,
      organizationName,
    }),
    footer: t("chat.invitation.footer"),
    greeting: t("chat.invitation.greeting"),
    linkInstructions: t("chat.invitation.linkInstructions"),
    subject: t("chat.invitation.subject"),
    title: t("chat.invitation.title", { channelName, organizationName }),
  });
}

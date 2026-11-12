import { createEmailTranslator } from "../i18n/translate.js";
import { renderActionEmail } from "../templates/action-email.js";
import { renderCodeEmail } from "../templates/code-email.js";
import type {
  DataRoomCodeEmailProps,
  DataRoomFirstVisitEmailProps,
  DataRoomInvitationEmailProps,
  RenderedEmail,
} from "../types.js";

/** Someone was let into a data room: the way in. */
export async function renderDataRoomInvitationEmail({
  invitationLink,
  invitorUsername,
  locale,
  roomName,
}: DataRoomInvitationEmailProps): Promise<RenderedEmail> {
  const { locale: lang, t } = createEmailTranslator(locale);
  const body = t("dataRoom.invitation.message", { invitorUsername, roomName });
  return renderActionEmail({
    lang,
    actionLabel: t("dataRoom.invitation.button"),
    actionUrl: invitationLink,
    body,
    footer: t("dataRoom.invitation.footer"),
    greeting: t("dataRoom.invitation.greeting"),
    linkInstructions: t("dataRoom.invitation.linkInstructions"),
    preview: body,
    subject: t("dataRoom.invitation.subject", { roomName }),
    title: t("dataRoom.invitation.title", { roomName }),
  });
}

/** The one-time code that opens a data room in this browser. */
export async function renderDataRoomCodeEmail({
  code,
  expiresInMinutes,
  locale,
  roomName,
}: DataRoomCodeEmailProps): Promise<RenderedEmail> {
  const { locale: lang, t } = createEmailTranslator(locale);
  return renderCodeEmail({
    lang,
    body: t("dataRoom.code.message", { minutes: expiresInMinutes, roomName }),
    code,
    footer: t("dataRoom.code.footer"),
    greeting: t("dataRoom.code.greeting"),
    subject: t("dataRoom.code.subject", { code, roomName }),
    title: t("dataRoom.code.title", { roomName }),
  });
}

/** Tells the owner someone opened their data room for the first time. */
export async function renderDataRoomFirstVisitEmail({
  activityLink,
  locale,
  roomName,
  visitor,
}: DataRoomFirstVisitEmailProps): Promise<RenderedEmail> {
  const { locale: lang, t } = createEmailTranslator(locale);
  const body = t("dataRoom.firstVisit.message", { roomName, visitor });
  return renderActionEmail({
    lang,
    actionLabel: t("dataRoom.firstVisit.button"),
    actionUrl: activityLink,
    body,
    footer: t("dataRoom.firstVisit.footer"),
    greeting: t("dataRoom.firstVisit.greeting"),
    linkInstructions: t("dataRoom.firstVisit.linkInstructions"),
    preview: body,
    subject: t("dataRoom.firstVisit.subject", { roomName, visitor }),
    title: t("dataRoom.firstVisit.title", { roomName }),
  });
}

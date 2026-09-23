import { createEmailTranslator } from "../i18n/translate.js";
import { renderActionEmail } from "../templates/action-email.js";
import type { BillingLowBalanceEmailProps, RenderedEmail } from "../types.js";
import { footerNote } from "./notification-shared.js";

const BILLING_SCOPE = "notifications.billing";

export function renderLowBalanceEmail({
  actionUrl,
  credits,
  locale,
  recipientName,
  settingsUrl,
}: BillingLowBalanceEmailProps): Promise<RenderedEmail> {
  const { locale: lang, rich, t } = createEmailTranslator(locale);
  const trimmedName = recipientName?.trim();
  const values = { credits: String(credits) };
  const body = t(`${BILLING_SCOPE}.lowBalance.body`, values);

  return renderActionEmail({
    actionLabel: t(`${BILLING_SCOPE}.lowBalance.button`),
    actionUrl,
    body,
    footer: footerNote(rich, `${BILLING_SCOPE}.footer`, settingsUrl),
    lang,
    greeting: trimmedName
      ? t(`${BILLING_SCOPE}.greeting`, { name: trimmedName })
      : t(`${BILLING_SCOPE}.greetingWithoutName`),
    linkInstructions: t(`${BILLING_SCOPE}.linkInstructions`),
    preview: t(`${BILLING_SCOPE}.lowBalance.preview`, values),
    subject: t(`${BILLING_SCOPE}.lowBalance.subject`, values),
    title: t(`${BILLING_SCOPE}.lowBalance.title`),
  });
}

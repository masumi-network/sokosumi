import { waitUntil } from "@vercel/functions";

import { type SendEmailInput, sendEmail } from "@/clients/email.client";
import { captureExternalServiceError } from "@/lib/external-service-errors";

interface BackgroundEmailReport {
  /** Names the failure in logs, and is its Sentry `context` tag. */
  label: string;
  extra?: Record<string, unknown>;
  /** Fixed text in place of a provider error that may echo the recipient. */
  message?: string;
}

/**
 * Sends an email after the response, kept alive past it on Vercel. A failed
 * send is reported, never thrown: the request it belongs to already answered.
 */
export function sendEmailInBackground(
  input: SendEmailInput,
  { label, extra, message }: BackgroundEmailReport,
): void {
  waitUntil(
    sendEmail(input).catch((error: unknown) => {
      captureExternalServiceError(error, {
        label,
        sentry: { tags: { context: label } },
        ...(extra ? { extra } : {}),
        ...(message ? { message } : {}),
      });
    }),
  );
}

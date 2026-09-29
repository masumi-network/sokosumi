import { Resend } from "resend";

import { getEnv } from "@/config/env";

let resendClient: Resend | null = null;

/**
 * Built on first use rather than at import. The notification helpers every
 * route loads import this module, and a client built at import would read
 * the key in every test that mocks the environment for something else.
 */
function resend(): Resend {
  if (!resendClient) {
    resendClient = new Resend(getEnv().RESEND_API_KEY);
  }
  return resendClient;
}

export const RESEND_BATCH_MAX_SIZE = 100;

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  tag: string;
  bcc?: string | string[];
  /**
   * When Resend should send it, as an ISO instant. Absent means now.
   *
   * Resend holds a scheduled email for up to 30 days and gives it an id at
   * once, so the caller can cancel it by that id before it leaves.
   */
  scheduledAt?: string;
  /**
   * A key Resend keeps for a day, so a retried send of the same email is
   * answered with the first send's id rather than sent again.
   */
  idempotencyKey?: string;
}

function toResendPayload(input: SendEmailInput) {
  return {
    from: getEnv().RESEND_FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
    ...(input.scheduledAt !== undefined
      ? { scheduledAt: input.scheduledAt }
      : {}),
    tags: [{ name: "category", value: input.tag }],
  };
}

function throwResendError(error: {
  message: string;
  name: string;
  statusCode: number | null;
}): never {
  throw Object.assign(new Error(error.message), {
    name: error.name,
    statusCode: error.statusCode,
    cause: error,
  });
}

export async function sendEmail(
  input: SendEmailInput,
): Promise<{ id: string }> {
  const payload = toResendPayload(input);
  const { data, error } =
    input.idempotencyKey === undefined
      ? await resend().emails.send(payload)
      : await resend().emails.send(payload, {
          idempotencyKey: input.idempotencyKey,
        });

  if (error) {
    throwResendError(error);
  }

  if (!data?.id) {
    throw new Error("Resend email send returned no id");
  }

  return { id: data.id };
}

/**
 * Take back a scheduled email before Resend sends it.
 *
 * Throws when Resend refuses, which includes an email that has already left:
 * the caller decides what a refusal costs, and here it costs nothing but the
 * email the reader was going to get anyway.
 */
export async function cancelEmail(id: string): Promise<void> {
  const { error } = await resend().emails.cancel(id);

  if (error) {
    throwResendError(error);
  }
}

export async function sendEmails(
  inputs: SendEmailInput[],
): Promise<{ id: string }[]> {
  if (inputs.length === 0) {
    return [];
  }

  const ids: { id: string }[] = [];

  for (
    let offset = 0;
    offset < inputs.length;
    offset += RESEND_BATCH_MAX_SIZE
  ) {
    const chunk = inputs.slice(offset, offset + RESEND_BATCH_MAX_SIZE);
    const { data, error } = await resend().batch.send(
      chunk.map((input) => toResendPayload(input)),
    );

    if (error) {
      throwResendError(error);
    }

    const results = data?.data;
    if (!results || results.length !== chunk.length) {
      throw new Error("Resend batch send returned unexpected result length");
    }

    for (const item of results) {
      if (!item?.id) {
        throw new Error("Resend batch send returned no id");
      }
      ids.push({ id: item.id });
    }
  }

  return ids;
}

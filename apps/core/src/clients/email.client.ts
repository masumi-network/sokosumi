import { Resend } from "resend";

import { getEnv } from "@/config/env";

const resend = new Resend(getEnv().RESEND_API_KEY);

export const RESEND_BATCH_MAX_SIZE = 100;

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  tag: string;
  bcc?: string | string[];
}

function toResendPayload(input: SendEmailInput) {
  return {
    from: getEnv().RESEND_FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
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
  const { data, error } = await resend.emails.send(toResendPayload(input));

  if (error) {
    throwResendError(error);
  }

  if (!data?.id) {
    throw new Error("Resend email send returned no id");
  }

  return { id: data.id };
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
    const { data, error } = await resend.batch.send(
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

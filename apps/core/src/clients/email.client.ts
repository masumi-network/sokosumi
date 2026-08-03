import { Resend } from "resend";

import { getEnv } from "@/config/env";

const resend = new Resend(getEnv().RESEND_API_KEY);

function toCategoryTags(tag: string): { name: string; value: string }[] {
  return [{ name: "category", value: tag }];
}

function throwIfResendError(error: unknown): never {
  if (error instanceof Error) {
    throw error;
  }

  if (
    error !== null &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    const message = (error as { message: string }).message;
    const name =
      "name" in error && typeof (error as { name: unknown }).name === "string"
        ? (error as { name: string }).name
        : "ResendError";
    throw Object.assign(new Error(message), { name, cause: error });
  }

  throw new Error("Resend email send failed");
}

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  html: string;
  tag: string;
  bcc?: string | string[];
}): Promise<{ id: string }> {
  const { data, error } = await resend.emails.send({
    from: getEnv().RESEND_FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
    tags: toCategoryTags(input.tag),
  });

  if (error) {
    throwIfResendError(error);
  }

  if (!data?.id) {
    throw new Error("Resend email send returned no id");
  }

  return { id: data.id };
}

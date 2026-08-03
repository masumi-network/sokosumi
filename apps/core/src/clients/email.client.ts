import { Resend } from "resend";

import { getEnv } from "@/config/env";

const resend = new Resend(getEnv().RESEND_API_KEY);

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
    tags: [{ name: "category", value: input.tag }],
  });

  if (error) {
    throw Object.assign(new Error(error.message), {
      name: error.name,
      statusCode: error.statusCode,
      cause: error,
    });
  }

  if (!data?.id) {
    throw new Error("Resend email send returned no id");
  }

  return { id: data.id };
}

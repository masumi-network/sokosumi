import { Resend } from "resend";

import { getEnv } from "@/config/env";

const resend = new Resend(getEnv().RESEND_API_KEY);

/**
 * Resend account limit is 10 requests/second. Stay under that so one Core
 * isolate (e.g. GET /sync/jobs firing many job-final-status emails) cannot
 * self-inflict rate_limit_exceeded (SOKOSUMI-CORE-2Y).
 */
export const RESEND_MAX_REQUESTS_PER_SECOND = 9;
const RESEND_RATE_WINDOW_MS = 1000;

const recentSendStarts: number[] = [];
let rateLimitGate: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pruneSendStarts(now: number): void {
  while (
    recentSendStarts.length > 0 &&
    recentSendStarts[0]! <= now - RESEND_RATE_WINDOW_MS
  ) {
    recentSendStarts.shift();
  }
}

/**
 * Serialize slot acquisition so concurrent sendEmail callers share one
 * sliding window. Actual HTTP sends may still overlap after a slot is taken.
 */
async function acquireResendRateSlot(): Promise<void> {
  const run = async (): Promise<void> => {
    for (;;) {
      const now = Date.now();
      pruneSendStarts(now);
      if (recentSendStarts.length < RESEND_MAX_REQUESTS_PER_SECOND) {
        recentSendStarts.push(Date.now());
        return;
      }

      const oldest = recentSendStarts[0];
      const waitMs =
        oldest === undefined
          ? 1
          : Math.max(oldest + RESEND_RATE_WINDOW_MS - Date.now() + 1, 1);
      await sleep(waitMs);
    }
  };

  const scheduled = rateLimitGate.then(run, run);
  rateLimitGate = scheduled.then(
    () => undefined,
    () => undefined,
  );
  await scheduled;
}

export async function sendEmail(input: {
  to: string | string[];
  subject: string;
  html: string;
  tag: string;
  bcc?: string | string[];
}): Promise<{ id: string }> {
  await acquireResendRateSlot();

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

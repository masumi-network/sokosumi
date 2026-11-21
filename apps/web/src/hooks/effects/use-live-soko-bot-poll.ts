"use client";

import { SokoBotStatus } from "@sokosumi/core-client";
import { useEffect, useState } from "react";
import { z } from "zod";

const ACTIVITY_ENDPOINT = "/api/personal-assistant/activity";
/**
 * Slower than the console's 2.5 s probe: this row is on every page, and a turn
 * that starts and ends between two asks still leaves its last activity behind.
 */
const POLL_MS = 5_000;
const PROBE_TIMEOUT_MS = 8_000;

const activityResponseSchema = z.object({
  activity: z.object({
    status: z.enum(SokoBotStatus),
    // Optional until every Core answers with it; a missing one keeps the
    // rendered time.
    lastActivityAt: z.coerce.date().nullable().optional(),
  }),
});

export type LiveSokoBotFields = Omit<
  z.infer<typeof activityResponseSchema>["activity"],
  "lastActivityAt"
> & { lastActivityAt: Date | null };

/**
 * Polls the sidebar Soko Bot's status and last activity while the tab is
 * visible, discarding any stale poll overlay when `botIdentity` changes.
 */
export function useLiveSokoBotPoll(
  botIdentity: unknown,
): Partial<LiveSokoBotFields> | null {
  const [live, setLive] = useState<Partial<LiveSokoBotFields> | null>(null);
  const [prevBot, setPrevBot] = useState(botIdentity);

  // Discard the poll overlay when the server-rendered bot identity changes.
  if (botIdentity !== prevBot) {
    setPrevBot(botIdentity);
    setLive(null);
  }

  useEffect(() => {
    let stopped = false;
    let asking = false;

    async function ask() {
      if (stopped || asking || document.visibilityState !== "visible") return;
      asking = true;
      try {
        const response = await fetch(ACTIVITY_ENDPOINT, {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!response.ok) return;
        const body = activityResponseSchema.safeParse(await response.json());
        if (body.success && !stopped) {
          const { lastActivityAt, ...rest } = body.data.activity;
          setLive(
            lastActivityAt === undefined ? rest : { ...rest, lastActivityAt },
          );
        }
      } catch {
        // Offline or timed out: the next ask retries.
      } finally {
        asking = false;
      }
    }

    void ask();
    const interval = setInterval(() => void ask(), POLL_MS);
    const onVisibility = () => void ask();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return live;
}

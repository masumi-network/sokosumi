import { SokoBotAvatarState, SokoBotStatus } from "@sokosumi/core-client";
import { useEffect, useState } from "react";
import { z } from "zod";

const ACTIVITY_ENDPOINT = "/api/personal-assistant/activity";
/**
 * Slower than the console's 2.5 s probe: this row is on every page, and a turn
 * that starts and ends between two asks still leaves "Done" behind it.
 */
const POLL_MS = 5_000;
const PROBE_TIMEOUT_MS = 8_000;

const activityResponseSchema = z.object({
  activity: z.object({
    status: z.enum(SokoBotStatus),
    avatarState: z.enum(SokoBotAvatarState),
  }),
});

type LiveFields = z.infer<typeof activityResponseSchema>["activity"];

/**
 * Your bot as the server rendered it, kept current. The layout renders once and
 * stays mounted across navigation, so without this the row never changes.
 * Asks only while the tab is visible, and a failed ask keeps what it knows.
 */
export function useLiveSokoBot<Bot extends LiveFields>(bot: Bot): Bot {
  const [live, setLive] = useState<LiveFields | null>(null);
  const [prevBot, setPrevBot] = useState(bot);

  // Discard the poll overlay when the server-rendered bot identity changes.
  if (bot !== prevBot) {
    setPrevBot(bot);
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
        if (body.success && !stopped) setLive(body.data.activity);
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

  return live ? { ...bot, ...live } : bot;
}

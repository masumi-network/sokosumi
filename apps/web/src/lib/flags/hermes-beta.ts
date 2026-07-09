import { vercelAdapter } from "@flags-sdk/vercel";
import { flag } from "flags/next";

import { type FlagEntities, identify } from "@/lib/flags/identify";

/**
 * Hermes beta gate — managed in the Vercel Flags dashboard.
 * Create a boolean flag with key `hermes-beta-enabled` and target via
 * `user.email` / `user.id` (see `identify`).
 */
export const hermesBetaEnabled = flag<boolean, FlagEntities>({
  key: "hermes-beta-enabled",
  description: "Show Hermes beta navigation and allow /hermes routes",
  adapter: vercelAdapter(),
  identify,
  defaultValue: false,
  options: [
    { value: false, label: "Off" },
    { value: true, label: "On" },
  ],
});

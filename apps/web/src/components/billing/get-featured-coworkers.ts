import "server-only";

import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { coworkerService } from "@/lib/services/coworker.service";
import type { CoworkerOption } from "@/lib/types/coworker";

/** The coworkers featured in the post-purchase "start a task" pick. */
const FEATURED_COWORKER_SLUGS = ["elena", "hannah", "alex"];

/**
 * The coworkers to feature right after a purchase, in curated order. Renders
 * however many of the three actually exist/are whitelisted in this
 * environment (0-3) — no placeholder slots for missing ones.
 */
export async function getFeaturedCoworkers(): Promise<CoworkerOption[]> {
  const coworkers = await coworkerService
    .listCoworkers("tasks")
    .catch(() => []);
  const options = getCoworkerOptions(coworkers);
  const bySlug = new Map(options.map((option) => [option.slug, option]));

  return FEATURED_COWORKER_SLUGS.map((slug) => bySlug.get(slug)).filter(
    (option): option is CoworkerOption => Boolean(option),
  );
}

import { sanitizeChannelSlug } from "@sokosumi/utils";

const SLUG_MAX_LENGTH = 60;

/** Kebab slug of the name, cut at a dash boundary so no word is chopped. */
function slugifyTaskName(name: string): string {
  const slug = sanitizeChannelSlug(name);
  if (slug.length <= SLUG_MAX_LENGTH) return slug;

  const head = slug.slice(0, SLUG_MAX_LENGTH);
  if (slug[SLUG_MAX_LENGTH] === "-") return head;

  // A single 60+ character word has no dash to cut at: keep the hard cut.
  const lastDash = head.lastIndexOf("-");
  return lastDash > 0 ? head.slice(0, lastDash) : head;
}

/**
 * Canonical task URL: `/tasks/SOK-12-fix-login` when the task has a project
 * identifier, `/tasks/{id}` otherwise. Core resolves either (and ignores the
 * slug), so a stale slug still opens the task.
 */
export function taskHref(task: {
  id: string;
  identifier: string | null;
  name: string;
}): string {
  if (!task.identifier) return `/tasks/${task.id}`;

  const slug = slugifyTaskName(task.name);
  return slug
    ? `/tasks/${task.identifier}-${slug}`
    : `/tasks/${task.identifier}`;
}

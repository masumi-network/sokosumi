import type { CmoCalendarEntry, SocialPostPlanning } from "@sokosumi/soko-bot";
import {
  SOCIAL_POST_TEXT_LIMITS,
  type SocialPostProvider,
} from "@sokosumi/utils";

export function clipText(text: string, provider: string): string {
  return text
    .trim()
    .slice(0, SOCIAL_POST_TEXT_LIMITS[provider as SocialPostProvider] ?? 280);
}

/**
 * Until a piece is written its text is the entry's brief (or title); a post
 * whose text differs has its words.
 */
export function placeholderText(
  entry: Pick<CmoCalendarEntry, "brief" | "title">,
  provider: string,
): string {
  return clipText(entry.brief ?? entry.title, provider);
}

/** Whether a planned post's text is its words, not its placeholder. */
export function postWritten(
  post: { text: string; provider: string },
  planning: SocialPostPlanning | null | undefined,
): boolean {
  const title = planning?.title ?? post.text.slice(0, 80);
  return (
    post.text.trim() !== "" &&
    post.text !== placeholderText({ ...planning, title }, post.provider)
  );
}

/** Whether a talking video's post now speaks other words, or with another presenter or voice. */
export function spokenChanged(
  before: SocialPostPlanning | null | undefined,
  after: Pick<SocialPostPlanning, "script" | "presenter" | "voice">,
): boolean {
  if (!before?.script?.trim()) return false;
  return (
    before.script.trim() !== after.script?.trim() ||
    (before.presenter ?? "").toLowerCase() !==
      (after.presenter ?? "").toLowerCase() ||
    (before.voice ?? "").toLowerCase() !== (after.voice ?? "").toLowerCase()
  );
}

import { z } from "zod";
import { isMessageKey, isUnderBase, t } from "../shell/text.ts";

/** What the Task views share: the assignee, status words and the Web link. */

const Named = z.object({ name: z.string() }).nullish();

/** A Task's assignee, or an event's actor: one of a person, a Coworker or a Soko Bot. */
export const Party = z
  .object({ user: Named, coworker: Named, sokoBot: Named })
  .partial()
  .nullish();
export type Party = z.infer<typeof Party>;

export function partyName(party: Party): string | undefined {
  const { user, coworker, sokoBot } = party ?? {};
  return (user ?? coworker ?? sokoBot)?.name;
}

/** Up to two letters: the first of the first and last words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word?: string) => (word ? Array.from(word)[0] : "");
  const letters =
    words.length > 1 ? first(words[0]) + first(words.at(-1)) : first(words[0]);
  return letters.toUpperCase();
}

/** Web's word for a Task status, if it is one this package knows. */
export function statusWord(status: string): string | undefined {
  const key = `task.status.${status}`;
  return isMessageKey(key) ? t(key) : undefined;
}

/**
 * The Task's Web page. Web resolves a Task by id in any workspace the person
 * can open; an identifier resolves only in the active one (apps/web task-href.ts).
 */
export function taskWebUrl(id: string, base?: string): string | undefined {
  if (!base) return undefined;
  const url = `${base.replace(/\/$/, "")}/tasks/${encodeURIComponent(id)}`;
  return isUnderBase(url, base) ? url : undefined;
}

/** Initials in a circle, with the full name for screen readers. No remote image (ADR 0083). */
export function AssigneeBadge({ name }: { name: string }) {
  return (
    <span
      title={name}
      className="border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium"
    >
      <span aria-hidden="true">{initials(name)}</span>
      <span className="sr-only">{t("task.assignee", { name })}</span>
    </span>
  );
}

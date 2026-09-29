"use client";

import { useTranslations } from "next-intl";

interface TypingParticipant {
  id: string;
  name?: string | null;
}

interface RoomTypingLineProps {
  /** Live typists, in the order they started. Never includes the reader. */
  typistIds: readonly string[];
  usersById?: Map<string, TypingParticipant>;
}

/**
 * Past two, the line stops naming people: three full names overflow the
 * composer width and truncate, and a cut-off name reads worse than none.
 */
const NAME_LIMIT = 2;

/**
 * The Typing line: who is composing a message to this room right now.
 *
 * Placement is the composer form's, and differs by width (ADR-0033):
 * - **Narrow**: an ordinary row above the composer card, holding its height
 *   whether or not anyone is typing, so the composer never moves under a
 *   reader mid-sentence. It costs one line of the transcript.
 * - **`md` and up**: out of flow, in the bottom padding the form already has.
 *   That space exists either way, so the transcript keeps its full height and
 *   still nothing moves.
 *
 * Always rendered, with only its text swapped. A live region that mounts
 * together with its text usually fails to announce, so the persistent node is
 * doing two jobs: reserving the narrow-layout row, and being a region screen
 * readers actually follow.
 *
 * Static, because an animated indicator would read as a coworker's Thought.
 */
export function RoomTypingLine({ typistIds, usersById }: RoomTypingLineProps) {
  const t = useTranslations("App.Chat.Chat");

  // A typist we cannot name has almost certainly just left the room; drop them
  // rather than render a placeholder person.
  const names = typistIds
    .map((id) => usersById?.get(id)?.name?.trim())
    .filter((name): name is string => Boolean(name));

  let label: string | null = null;
  if (names.length > NAME_LIMIT) {
    label = t("typing.many");
  } else if (names.length === 2) {
    label = t("typing.two", { first: names[0], second: names[1] });
  } else if (names.length === 1) {
    label = t("typing.one", { name: names[0] });
  }

  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      className="text-muted-foreground min-h-5 truncate px-4 text-xs md:absolute md:inset-x-0 md:bottom-1 md:min-h-0 md:px-9"
      data-testid="room-typing-line"
    >
      {label}
    </p>
  );
}

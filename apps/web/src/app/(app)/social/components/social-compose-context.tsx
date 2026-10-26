"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { createContext, useContext, useState } from "react";

interface SocialCompose {
  open: boolean;
  /** The time the composer starts on, when it was opened for one calendar day. */
  scheduledAt: Date | null;
  setOpen: (open: boolean, options?: { scheduledAt?: Date }) => void;
}

const SocialComposeContext = createContext<SocialCompose | null>(null);

/**
 * Whether Social's Manual post composer is open.
 *
 * The New post menu sits at the top of the page, above the calendar, while
 * the composer belongs to the posts list further down (it owns the saved-post
 * state the composer feeds). The two meet here. `?compose=new` opens it too:
 * the menu sets it when it first had to ask for a project, and it is cleared
 * on close so a reload does not reopen an empty composer. The calendar opens
 * it for one day, with that day's time already picked.
 */
export function SocialComposeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [compose, setCompose] = useQueryState(
    "compose",
    parseAsStringLiteral(["new"]),
  );
  const [openedHere, setOpenedHere] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);

  function setOpen(next: boolean, options?: { scheduledAt?: Date }) {
    setOpenedHere(next);
    setScheduledAt(next ? (options?.scheduledAt ?? null) : null);
    if (!next && compose) void setCompose(null);
  }

  return (
    <SocialComposeContext
      value={{ open: openedHere || compose === "new", scheduledAt, setOpen }}
    >
      {children}
    </SocialComposeContext>
  );
}

export function useSocialCompose(): SocialCompose | null {
  return useContext(SocialComposeContext);
}

"use client";

import { parseAsIsoDateTime, parseAsStringLiteral, useQueryStates } from "nuqs";
import { createContext, useContext, useState } from "react";

interface SocialCompose {
  open: boolean;
  /** The time the calendar proposed for the new post, if it was started there. */
  scheduledAt: Date | null;
  setOpen: (open: boolean) => void;
  /** Opens the composer on a time the reader picked on the calendar. */
  openAt: (scheduledAt: Date) => void;
}

const SocialComposeContext = createContext<SocialCompose | null>(null);

const composeParsers = {
  compose: parseAsStringLiteral(["new"]),
  composeAt: parseAsIsoDateTime,
};

/**
 * Whether Social's Manual post composer is open, and at what time.
 *
 * The New post menu sits at the top of the page, above the calendar, while
 * the composer belongs to the posts list further down (it owns the saved-post
 * state the composer feeds). The calendar starts posts too, on the day or
 * slot the reader picked. They meet here. `?compose=new` (with `composeAt`
 * for a picked time) opens it too: the menu sets it when it first had to ask
 * for a project, and it is cleared on close so a reload does not reopen an
 * empty composer.
 *
 * With no project in scope there is no composer on the page; the New post
 * menu reads `open` as "ask for a project first".
 */
export function SocialComposeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [params, setParams] = useQueryStates(composeParsers);
  const [openedHere, setOpenedHere] = useState(false);
  const [scheduledAtHere, setScheduledAtHere] = useState<Date | null>(null);

  function setOpen(next: boolean) {
    setOpenedHere(next);
    setScheduledAtHere(null);
    if (!next && (params.compose || params.composeAt)) {
      void setParams({ compose: null, composeAt: null });
    }
  }

  function openAt(scheduledAt: Date) {
    setOpenedHere(true);
    setScheduledAtHere(scheduledAt);
  }

  return (
    <SocialComposeContext
      value={{
        open: openedHere || params.compose === "new",
        scheduledAt: scheduledAtHere ?? params.composeAt,
        setOpen,
        openAt,
      }}
    >
      {children}
    </SocialComposeContext>
  );
}

export function useSocialCompose(): SocialCompose | null {
  return useContext(SocialComposeContext);
}

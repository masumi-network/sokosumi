"use client";

import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { createContext, useContext, useState } from "react";

const SCHEDULE_VALUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

interface SocialCompose {
  open: boolean;
  /** A local `yyyy-MM-ddTHH:mm` slot the composer starts on, if one was picked. */
  scheduledAt: string | null;
  setOpen: (open: boolean) => void;
  /** Opens the composer on a slot, as the calendar's day "+" does. */
  openAt: (scheduledAt: string) => void;
}

const SocialComposeContext = createContext<SocialCompose | null>(null);

/**
 * Whether Social's Manual post composer is open.
 *
 * The New post menu sits at the top of the page, above the calendar, while
 * the composer belongs to the posts list further down (it owns the saved-post
 * state the composer feeds). The two meet here. `?compose=new` opens it too:
 * the menu sets it when it first had to ask for a project, and it is cleared
 * on close so a reload does not reopen an empty composer. `?composeAt=` carries
 * the slot a calendar day asked for across that same project pick.
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
  const [composeAt, setComposeAt] = useQueryState("composeAt", parseAsString);
  const [openedHere, setOpenedHere] = useState(false);

  function setOpen(next: boolean) {
    setOpenedHere(next);
    if (!next && (compose || composeAt)) {
      void setCompose(null);
      void setComposeAt(null);
    }
  }

  function openAt(scheduledAt: string) {
    setOpenedHere(true);
    void setComposeAt(scheduledAt);
  }

  return (
    <SocialComposeContext
      value={{
        open: openedHere || compose === "new",
        scheduledAt:
          composeAt && SCHEDULE_VALUE.test(composeAt) ? composeAt : null,
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

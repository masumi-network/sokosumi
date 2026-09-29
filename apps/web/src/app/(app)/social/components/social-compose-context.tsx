"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { createContext, useContext, useState } from "react";

interface SocialCompose {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SocialComposeContext = createContext<SocialCompose | null>(null);

/**
 * Whether Social's "Write it myself" composer is open.
 *
 * The New post menu sits at the top of the page, above the calendar, while
 * the composer belongs to the posts list further down (it owns the saved-post
 * state the composer feeds). The two meet here. `?compose=new` opens it too:
 * the menu sets it when it first had to ask for a project, and it is cleared
 * on close so a reload does not reopen an empty composer.
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

  function setOpen(next: boolean) {
    setOpenedHere(next);
    if (!next && compose) void setCompose(null);
  }

  return (
    <SocialComposeContext
      value={{ open: openedHere || compose === "new", setOpen }}
    >
      {children}
    </SocialComposeContext>
  );
}

export function useSocialCompose(): SocialCompose | null {
  return useContext(SocialComposeContext);
}

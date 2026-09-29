"use client";

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
 * state the composer feeds). The two meet here. `initialOpen` carries
 * `?compose=new`, which the menu sets when it first had to ask for a project.
 */
export function SocialComposeProvider({
  children,
  initialOpen = false,
}: {
  children: React.ReactNode;
  initialOpen?: boolean;
}) {
  const [open, setOpenState] = useState(initialOpen);

  function setOpen(next: boolean) {
    setOpenState(next);
    if (next) return;
    // Spent once closed: a reload should not reopen an empty composer.
    const url = new URL(window.location.href);
    if (!url.searchParams.has("compose")) return;
    url.searchParams.delete("compose");
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <SocialComposeContext value={{ open, setOpen }}>
      {children}
    </SocialComposeContext>
  );
}

export function useSocialCompose(): SocialCompose | null {
  return useContext(SocialComposeContext);
}

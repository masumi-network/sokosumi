"use client";

import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { createContext, useContext, useRef, useState } from "react";

interface SocialCompose {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const SocialComposeContext = createContext<SocialCompose | null>(null);

/**
 * Whether Social's Manual post composer is open.
 *
 * The New post menu sits at the top of the page, above the calendar, while
 * the composer belongs to the posts list further down (it owns the saved-post
 * state the composer feeds). The two meet here. `?compose=new` opens it too:
 * the menu sets it when it first had to ask for a project, and it is cleared
 * on close so a reload does not reopen an empty composer.
 *
 * Switching projects remounts the session so an open composer cannot follow
 * the reader onto the next project's accounts. Leftover `?compose=new` is
 * ignored on that remount: first pick (no project → one) still honors it.
 */
export function SocialComposeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [projectId] = useQueryState("projectId", parseAsString);
  const previousProjectId = useRef(projectId);
  const switchedFromProject =
    Boolean(previousProjectId.current) &&
    previousProjectId.current !== projectId;
  if (previousProjectId.current !== projectId) {
    previousProjectId.current = projectId;
  }
  return (
    <SocialComposeSession
      key={projectId ?? ""}
      takeUrlCompose={!switchedFromProject}
    >
      {children}
    </SocialComposeSession>
  );
}

function SocialComposeSession({
  children,
  takeUrlCompose,
}: {
  children: React.ReactNode;
  takeUrlCompose: boolean;
}) {
  const [compose, setCompose] = useQueryState(
    "compose",
    parseAsStringLiteral(["new"]),
  );
  const [openedHere, setOpenedHere] = useState(false);
  const [allowUrlCompose] = useState(takeUrlCompose);

  if (!allowUrlCompose && compose) {
    void setCompose(null);
  }

  function setOpen(next: boolean) {
    setOpenedHere(next);
    if (!next && compose) void setCompose(null);
  }

  return (
    <SocialComposeContext
      value={{
        open: openedHere || (allowUrlCompose && compose === "new"),
        setOpen,
      }}
    >
      {children}
    </SocialComposeContext>
  );
}

export function useSocialCompose(): SocialCompose | null {
  return useContext(SocialComposeContext);
}

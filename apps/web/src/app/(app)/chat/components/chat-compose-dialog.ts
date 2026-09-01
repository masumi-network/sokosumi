"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type ChatComposeRoster,
  loadChatComposeRosterAction,
} from "@/app/chat/actions";

export const CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME =
  "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative flex size-7 items-center justify-center rounded-md transition-colors before:absolute before:-inset-2 before:content-[''] sm:before:hidden";

export const EMPTY_CHAT_COMPOSE_ROSTER: ChatComposeRoster = {
  currentUserId: "",
  organizationName: "",
  hasOrganization: false,
  canCreateExternal: false,
  members: [],
  coworkers: [],
  personalAssistant: null,
  membersLoadFailed: false,
};

export function useChatComposeRoster() {
  const [roster, setRoster] = useState<ChatComposeRoster>(
    EMPTY_CHAT_COMPOSE_ROSTER,
  );
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [rosterError, setRosterError] = useState(false);
  const [, startRosterTransition] = useTransition();
  const rosterLoadGenerationRef = useRef(0);

  function resetRoster() {
    rosterLoadGenerationRef.current += 1;
    setRoster(EMPTY_CHAT_COMPOSE_ROSTER);
    setRosterLoaded(false);
    setRosterError(false);
  }

  function loadRoster() {
    const generation = rosterLoadGenerationRef.current + 1;
    rosterLoadGenerationRef.current = generation;
    setRosterLoaded(false);
    setRosterError(false);
    startRosterTransition(async () => {
      const result = await loadChatComposeRosterAction();
      if (generation !== rosterLoadGenerationRef.current) {
        return;
      }
      if (!result.ok) {
        toast.error(result.error.message);
        setRosterError(true);
        setRosterLoaded(true);
        return;
      }
      setRoster(result.value);
      setRosterError(false);
      setRosterLoaded(true);
    });
  }

  return {
    roster,
    rosterLoaded,
    rosterError,
    loadRoster,
    resetRoster,
  };
}

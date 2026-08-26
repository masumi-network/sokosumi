import type { ChatComposeRoster } from "@/app/chat/actions";

export const CHAT_COMPOSE_PLUS_TRIGGER_CLASSNAME =
  "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground relative flex size-7 items-center justify-center rounded-md transition-colors before:absolute before:-inset-2 before:content-[''] sm:before:hidden";

export const EMPTY_CHAT_COMPOSE_ROSTER: ChatComposeRoster = {
  currentUserId: "",
  organizationName: "",
  hasOrganization: false,
  canCreateExternal: false,
  members: [],
  coworkers: [],
  membersLoadFailed: false,
};

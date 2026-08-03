export const CHANNEL_NAME_MAX = 80;

export type Discoverability = "public" | "private";
export type AddPeopleMode = "all" | "specific";

export type CreateChannelWizard =
  | { step: "name"; name: string }
  | { step: "visibility"; name: string; discoverability: Discoverability }
  | {
      step: "add-people";
      roomId: string;
      roomName: string;
      mode: AddPeopleMode;
      memberUserIds: string[];
      coworkerIds: string[];
    };

export function createInitialWizard(): CreateChannelWizard {
  return { step: "name", name: "" };
}

export function sanitizeChannelNameInput(raw: string): string {
  const withoutHash = raw.replace(/^#+/, "");
  return withoutHash.slice(0, CHANNEL_NAME_MAX);
}

export function canAdvanceFromName(wizard: CreateChannelWizard): boolean {
  if (wizard.step !== "name") {
    return false;
  }
  const length = wizard.name.trim().length;
  return length >= 1 && length <= CHANNEL_NAME_MAX;
}

export function advanceNameToVisibility(
  wizard: CreateChannelWizard,
): CreateChannelWizard | null {
  if (!canAdvanceFromName(wizard) || wizard.step !== "name") {
    return null;
  }
  return {
    step: "visibility",
    name: wizard.name.trim(),
    discoverability: "public",
  };
}

export function setDiscoverability(
  wizard: CreateChannelWizard,
  value: Discoverability,
): CreateChannelWizard {
  if (wizard.step !== "visibility") {
    return wizard;
  }
  return { ...wizard, discoverability: value };
}

export function backToName(wizard: CreateChannelWizard): CreateChannelWizard {
  if (wizard.step !== "visibility") {
    return wizard;
  }
  return { step: "name", name: wizard.name };
}

export function toAddPeople(
  wizard: CreateChannelWizard,
  room: { id: string; name: string },
): CreateChannelWizard {
  return {
    step: "add-people",
    roomId: room.id,
    roomName: room.name,
    mode: "all",
    memberUserIds: [],
    coworkerIds: [],
  };
}

export function setAddPeopleMode(
  wizard: CreateChannelWizard,
  mode: AddPeopleMode,
): CreateChannelWizard {
  if (wizard.step !== "add-people") {
    return wizard;
  }
  return { ...wizard, mode };
}

export function setSpecificMembers(
  wizard: CreateChannelWizard,
  members: { memberUserIds: string[]; coworkerIds: string[] },
): CreateChannelWizard {
  if (wizard.step !== "add-people") {
    return wizard;
  }
  return {
    ...wizard,
    memberUserIds: members.memberUserIds,
    coworkerIds: members.coworkerIds,
  };
}

export function remainingNameChars(name: string): number {
  return CHANNEL_NAME_MAX - name.length;
}

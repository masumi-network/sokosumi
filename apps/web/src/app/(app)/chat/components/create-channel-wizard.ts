import { sanitizeChannelSlug } from "@sokosumi/utils";

export const CHANNEL_NAME_MAX = 80;

export type Discoverability = "public" | "private" | "external";
export type AddPeopleMode = "all" | "specific";
export type ChannelSlugCheckState = "free" | "taken" | "unknown" | "invalid";

interface CreateChannelNameFields {
  name: string;
  slug: string;
  slugDirty: boolean;
}

export type CreateChannelWizard =
  | ({ step: "name" } & CreateChannelNameFields)
  | ({
      step: "visibility";
      discoverability: Discoverability;
    } & CreateChannelNameFields)
  | {
      step: "add-people";
      roomId: string;
      roomName: string;
      mode: AddPeopleMode;
      memberUserIds: string[];
      coworkerIds: string[];
    };

export function createInitialWizard(): CreateChannelWizard {
  return { step: "name", name: "", slug: "", slugDirty: false };
}

export function sanitizeChannelNameInput(raw: string): string {
  const withoutHash = raw.replace(/^#+/, "");
  return withoutHash.slice(0, CHANNEL_NAME_MAX);
}

export function setName(
  wizard: CreateChannelWizard,
  raw: string,
): CreateChannelWizard {
  if (wizard.step !== "name") {
    return wizard;
  }
  const name = sanitizeChannelNameInput(raw);
  return {
    ...wizard,
    name,
    slug: wizard.slugDirty ? wizard.slug : sanitizeChannelSlug(name),
  };
}

export function setSlug(
  wizard: CreateChannelWizard,
  raw: string,
): CreateChannelWizard {
  if (wizard.step !== "name") {
    return wizard;
  }
  return {
    ...wizard,
    slug: sanitizeChannelSlug(raw),
    slugDirty: true,
  };
}

export function canAdvanceFromName(
  wizard: CreateChannelWizard,
  availability: ChannelSlugCheckState,
): boolean {
  if (wizard.step !== "name") {
    return false;
  }
  const length = wizard.name.trim().length;
  return (
    length >= 1 &&
    length <= CHANNEL_NAME_MAX &&
    wizard.slug.length > 0 &&
    availability === "free"
  );
}

export function advanceNameToVisibility(
  wizard: CreateChannelWizard,
  availability: ChannelSlugCheckState,
): CreateChannelWizard | null {
  if (!canAdvanceFromName(wizard, availability) || wizard.step !== "name") {
    return null;
  }
  return {
    step: "visibility",
    name: wizard.name.trim(),
    slug: wizard.slug,
    slugDirty: wizard.slugDirty,
    discoverability: "public",
  };
}

export function createChannelSubmitFields(wizard: CreateChannelWizard): {
  name: string;
  slug: string;
  discoverability: Discoverability;
} | null {
  if (wizard.step !== "visibility") {
    return null;
  }
  return {
    name: wizard.name,
    slug: wizard.slug,
    discoverability: wizard.discoverability,
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
  return {
    step: "name",
    name: wizard.name,
    slug: wizard.slug,
    slugDirty: wizard.slugDirty,
  };
}

export function toAddPeople(
  wizard: CreateChannelWizard,
  room: { id: string; name: string },
  currentUserId: string,
): CreateChannelWizard {
  return {
    step: "add-people",
    roomId: room.id,
    roomName: room.name,
    mode: "all",
    memberUserIds: [currentUserId],
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

import {
  CHANNEL_SLUG_MAX_LENGTH,
  channelNameFromSlug,
  sanitizeChannelSlug,
} from "@sokosumi/utils";

export const CHANNEL_NAME_MAX = 80;
export const CHANNEL_SLUG_MAX = CHANNEL_SLUG_MAX_LENGTH;
export const CHANNEL_TOPIC_MAX = 200;

export type Discoverability = "public" | "private" | "external";
export type AddPeopleMode = "all" | "specific";
export type ChannelSlugCheckState =
  | "free"
  | "taken"
  | "unknown"
  | "invalid"
  | "error";

interface CreateChannelFormFields {
  slug: string;
  slugDirty: boolean;
  name: string;
  nameDirty: boolean;
  topic: string;
  discoverability: Discoverability;
}

export type CreateChannelWizard =
  | ({ step: "create" } & CreateChannelFormFields)
  | ({
      step: "add-people";
      mode: AddPeopleMode;
      memberUserIds: string[];
      coworkerIds: string[];
    } & CreateChannelFormFields);

export function createInitialWizard(): CreateChannelWizard {
  return {
    step: "create",
    slug: "",
    slugDirty: false,
    name: "",
    nameDirty: false,
    topic: "",
    discoverability: "public",
  };
}

export function sanitizeChannelNameInput(raw: string): string {
  const withoutHash = raw.replace(/^#+/, "");
  return withoutHash.slice(0, CHANNEL_NAME_MAX);
}

export function setSlug(
  wizard: CreateChannelWizard,
  raw: string,
): CreateChannelWizard {
  if (wizard.step !== "create") {
    return wizard;
  }
  const slug = sanitizeChannelSlug(raw).slice(0, CHANNEL_SLUG_MAX);
  return {
    ...wizard,
    slug,
    slugDirty: true,
    name: wizard.nameDirty ? wizard.name : channelNameFromSlug(slug),
  };
}

export function setName(
  wizard: CreateChannelWizard,
  raw: string,
): CreateChannelWizard {
  if (wizard.step !== "create") {
    return wizard;
  }
  return {
    ...wizard,
    name: sanitizeChannelNameInput(raw),
    nameDirty: true,
  };
}

export function setTopic(
  wizard: CreateChannelWizard,
  raw: string,
): CreateChannelWizard {
  if (wizard.step !== "create") {
    return wizard;
  }
  return {
    ...wizard,
    topic: raw.slice(0, CHANNEL_TOPIC_MAX),
  };
}

export function setDiscoverability(
  wizard: CreateChannelWizard,
  value: Discoverability,
): CreateChannelWizard {
  if (wizard.step !== "create") {
    return wizard;
  }
  return { ...wizard, discoverability: value };
}

export function canCreateChannel(
  wizard: CreateChannelWizard,
  availability: ChannelSlugCheckState,
): boolean {
  if (wizard.step !== "create") {
    return false;
  }
  const nameLength = wizard.name.trim().length;
  return (
    nameLength >= 1 &&
    nameLength <= CHANNEL_NAME_MAX &&
    wizard.slug.length > 0 &&
    availability === "free"
  );
}

export function createChannelSubmitFields(
  wizard: CreateChannelWizard,
  roster: { memberUserIds: string[]; coworkerIds: string[] },
): {
  name: string;
  slug: string;
  topic?: string;
  discoverability: Discoverability;
  memberUserIds: string[];
  coworkerIds: string[];
} | null {
  if (wizard.step !== "add-people") {
    return null;
  }
  const name = wizard.name.trim();
  if (name.length === 0 || wizard.slug.length === 0) {
    return null;
  }
  const topic = wizard.topic.trim();
  return {
    name,
    slug: wizard.slug,
    ...(topic.length > 0 ? { topic } : {}),
    discoverability: wizard.discoverability,
    memberUserIds: roster.memberUserIds,
    coworkerIds: roster.coworkerIds,
  };
}

export function toAddPeople(
  wizard: CreateChannelWizard,
  currentUserId: string,
): CreateChannelWizard {
  if (wizard.step !== "create") {
    return wizard;
  }
  return {
    ...wizard,
    step: "add-people",
    mode: "all",
    memberUserIds: [currentUserId],
    coworkerIds: [],
  };
}

export function backToCreate(wizard: CreateChannelWizard): CreateChannelWizard {
  if (wizard.step !== "add-people") {
    return wizard;
  }
  return {
    step: "create",
    slug: wizard.slug,
    slugDirty: wizard.slugDirty,
    name: wizard.name,
    nameDirty: wizard.nameDirty,
    topic: wizard.topic,
    discoverability: wizard.discoverability,
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

export function remainingTopicChars(topic: string): number {
  return CHANNEL_TOPIC_MAX - topic.length;
}

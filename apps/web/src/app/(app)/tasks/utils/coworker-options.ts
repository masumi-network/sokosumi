import { TaskEventOrigin } from "@sokosumi/database";

import type { Coworker } from "@/lib/clients/generated/core";
import type {
  CoworkerContactChannel,
  CoworkerOption,
} from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

const COWORKER_CHANNEL_SPECS: ReadonlyArray<{
  channelKey: string;
  origin: TaskEventOrigin;
}> = [
  { channelKey: "email", origin: TaskEventOrigin.EMAIL },
  { channelKey: "whatsapp", origin: TaskEventOrigin.WHATSAPP },
  { channelKey: "telegram", origin: TaskEventOrigin.TELEGRAM },
  { channelKey: "teams", origin: TaskEventOrigin.TEAMS },
  { channelKey: "discord", origin: TaskEventOrigin.DISCORD },
];

function getCoworkerContacts(coworker: Coworker): CoworkerContactChannel[] {
  const channels = coworker.metadata?.channels ?? {};
  const contacts: CoworkerContactChannel[] = [];

  for (const { channelKey, origin } of COWORKER_CHANNEL_SPECS) {
    const raw = channels[channelKey];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) {
      contacts.push({ origin, value });
    }
  }

  return contacts;
}

export function getCoworkerOptions(coworkers: Coworker[]): CoworkerOption[] {
  return coworkers.map((coworker) => {
    const slug = coworker.slug?.toLowerCase() ?? coworker.name.toLowerCase();
    return {
      id: coworker.id,
      name: coworker.name,
      image: coworker.image || COWORKER_FALLBACK_IMAGES[slug] || "",
      description: coworker.description || undefined,
      contacts: getCoworkerContacts(coworker),
    };
  });
}

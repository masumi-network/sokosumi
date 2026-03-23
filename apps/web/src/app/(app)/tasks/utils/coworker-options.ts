import { TaskEventOrigin } from "@sokosumi/database";

import type { Coworker } from "@/lib/clients/generated/core";
import type {
  CoworkerContactChannel,
  CoworkerOption,
} from "@/lib/types/coworker";

import { COWORKER_FALLBACK_IMAGES } from "./coworker-fallback-images";

function getCoworkerContacts(coworker: Coworker): CoworkerContactChannel[] {
  const channels = coworker.metadata?.channels ?? {};
  const email = channels.email?.trim() || "";
  const whatsapp = channels.whatsapp?.trim() || "";

  const contacts: CoworkerContactChannel[] = [];
  if (email) {
    contacts.push({ origin: TaskEventOrigin.EMAIL, value: email });
  }
  if (whatsapp) {
    contacts.push({ origin: TaskEventOrigin.WHATSAPP, value: whatsapp });
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

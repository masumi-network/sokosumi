import { isProviderEmail } from "@/lib/contacts/capture-filters";
import {
  field,
  list,
  type MailAddress,
  parseAddresses,
  text,
} from "@/lib/contacts/capture-provider";

export function mailboxAddresses(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return list(value).map((entry) => {
    const email = field(entry, "emailAddress", "email", "address");
    if (email && typeof email === "object") {
      const name = text(field(email, "name"));
      const address = text(field(email, "address", "email"));
      return name ? `${name} <${address}>` : address;
    }
    return text(email ?? entry);
  });
}

/** Resolve only the selected guests, using all names the invite supplied for their addresses. */
export function uniqueGuests(
  guests: readonly MailAddress[],
  additionalNames: readonly MailAddress[] = [],
): MailAddress[] {
  const namesByEmail = new Map<string, Map<string, string>>();
  for (const { email } of guests) {
    if (isProviderEmail(email)) namesByEmail.set(email, new Map());
  }
  for (const guest of [...guests, ...additionalNames]) {
    if (!guest.name) continue;
    const names = namesByEmail.get(guest.email);
    const key = guest.name.toLowerCase();
    if (names && !names.has(key)) names.set(key, guest.name);
  }
  return [...namesByEmail].map(([email, names]) => ({
    email,
    name: names.size === 1 ? (names.values().next().value ?? null) : null,
  }));
}

function displayAddress({ name, email }: MailAddress): string {
  return name ? `${name} <${email}>` : email;
}

export function invitationAddresses(event: unknown) {
  const attendees = parseAddresses(field(event, "attendees"), "invitation");
  const organizer = parseAddresses([field(event, "organizer")], "invitation");
  const [resolvedOrganizer] = uniqueGuests(organizer, attendees);
  return {
    attendees: uniqueGuests(attendees, organizer).map(displayAddress),
    organizer: resolvedOrganizer ? displayAddress(resolvedOrganizer) : null,
  };
}

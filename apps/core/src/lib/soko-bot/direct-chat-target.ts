import type { Prisma } from "@sokosumi/database";

/** A shared bot talks in its shared room; it never opens a private direct. */
export const SHARED_SOKO_BOT_NO_DIRECTS =
  "A shared Soko Bot has no direct chats. Answer in the room you were asked in.";

/** `%` and `_` are wildcards in Prisma's contains/startsWith filters. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * The person `open_direct_chat` names, as it is looked up. A leading "@" is
 * how the owner writes a handle ("ping @ben"), not part of the name, and left
 * on it nothing matches.
 */
export function directChatNeedle(person: string): string {
  return person.trim().replace(/^@+/, "");
}

/**
 * Members of the organization `needle` names. An address is matched against
 * addresses and a name against names, never both: a member who sets their
 * display name to counsel@outside.example would otherwise be the match when
 * the owner asks to contact counsel. It has to be a whole address, not merely
 * contain an "@": "@ben" is a handle, and looked up as an address it can only
 * ever miss.
 */
export function directChatMemberWhere(
  organizationId: string,
  needle: string,
): Prisma.MemberWhereInput {
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(needle);
  return {
    organizationId,
    user: looksLikeEmail
      ? { email: { equals: needle, mode: "insensitive" } }
      : {
          OR: [
            { name: { equals: needle, mode: "insensitive" } },
            // `%` and `_` are wildcards here, and this string comes from a
            // model reading untrusted text: unescaped, "%" alone would match
            // a colleague at random.
            {
              name: {
                startsWith: `${escapeLikePattern(needle)} `,
                mode: "insensitive",
              },
            },
          ],
        },
  };
}

/**
 * Naming the candidates lets the owner disambiguate; picking one for them
 * would mean approaching the wrong colleague. Full names separate two Ninas
 * without putting anyone's address into the transcript, and an address is
 * only offered when the names themselves collide. Compared the way the lookup
 * matches, or "Nina" and "NINA" read as two distinguishable names and the
 * owner is asked to choose between two strings that both match both people,
 * for ever.
 */
export function ambiguousDirectChatTargetMessage(
  needle: string,
  members: ReadonlyArray<{
    user: { name: string | null; email: string };
  }>,
): string {
  const namesCollide =
    new Set(members.map((m) => m.user.name?.trim().toLowerCase())).size < 2;
  return `More than one person matches "${needle}": ${members
    .map((m) => (namesCollide ? m.user.email : m.user.name))
    .join(", ")}. Ask the owner which they mean.`;
}

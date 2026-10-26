import { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import {
  contactListNameKey,
  ensureManualContactList,
} from "@/services/contact-lists.service";
import {
  type ContactWriteActor,
  upsertContactsByEmail,
} from "@/services/contacts.service";

/** Links one subscriber chunk and files its people in the newsletter's manual list. */
export async function linkNewsletterContacts(
  tx: Prisma.TransactionClient,
  newsletterId: string,
  actor: ContactWriteActor,
  subscribers: { email: string; name?: string | null }[],
  source: "MANUAL" | "IMPORT" | "OTHER",
) {
  const newsletter = await tx.newsletter.findUniqueOrThrow({
    where: { id: newsletterId, workspaceId: actor.workspaceId },
  });
  let list = newsletter.contactListId
    ? await tx.contactList.findFirst({
        where: {
          id: newsletter.contactListId,
          workspaceId: actor.workspaceId,
          smartFilter: { equals: Prisma.DbNull },
        },
        select: { id: true },
      })
    : null;
  if (!list) {
    const baseName = `${newsletter.name} subscribers`;
    const existing = await tx.contactList.findMany({
      where: {
        workspaceId: actor.workspaceId,
        nameKey: { startsWith: contactListNameKey(baseName) },
      },
      select: { nameKey: true, smartFilter: true },
    });
    let name = baseName;
    for (
      let suffix = 2;
      existing.some(
        (candidate) =>
          candidate.nameKey === contactListNameKey(name) &&
          candidate.smartFilter,
      );
      suffix++
    ) {
      name = `${baseName} (${suffix})`;
    }
    list = await ensureManualContactList(tx, actor, name, "gray");
    await tx.newsletter.update({
      where: { id: newsletter.id },
      data: { contactListId: list.id },
    });
    // Replacing a deleted or converted list must restore the whole linked audience.
    await tx.$executeRaw(PrismaRaw.sql`
      INSERT INTO "contact_list_member" ("listId", "contactId", "addedByUserId", "addedBySokoBotId")
      SELECT DISTINCT ${list.id}::uuid, person.id, ${actor.userId}, ${actor.sokoBotId}::uuid
      FROM "newsletter_subscriber" AS subscriber
      JOIN "contact" AS original ON original.id = subscriber."contactId"
      JOIN "contact" AS person ON person.id = COALESCE(original."mergedIntoId", original.id)
      WHERE subscriber."newsletterId" = ${newsletter.id}::uuid
        AND original."workspaceId" = ${actor.workspaceId}::uuid
        AND person."workspaceId" = ${actor.workspaceId}::uuid
      ON CONFLICT ("listId", "contactId") DO NOTHING
    `);
  }
  const contacts = await upsertContactsByEmail(tx, actor, subscribers, source);
  const contactIds = [
    ...new Set([...contacts.values()].map((contact) => contact.id)),
  ];
  if (contactIds.length) {
    await tx.contactListMember.createMany({
      data: contactIds.map((contactId) => ({
        listId: list.id,
        contactId,
        addedByUserId: actor.userId,
        addedBySokoBotId: actor.sokoBotId,
      })),
      skipDuplicates: true,
    });
    await tx.contactList.update({
      where: { id: list.id },
      data: { updatedAt: new Date() },
    });
  }
  return contacts;
}

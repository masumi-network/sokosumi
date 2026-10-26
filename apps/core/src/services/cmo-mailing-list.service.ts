import type { CmoHire } from "@sokosumi/database";
import { normalizeContactChannelValue } from "@sokosumi/utils";

import { forbidden, unprocessableEntity } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import {
  contactListNameKey,
  ensureManualContactList,
} from "@/services/contact-lists.service";
import {
  type ContactActor,
  inContactTransaction,
  upsertContact,
} from "@/services/contacts.service";

/** The contact list Cuso writes the newsletter for, in the CMO workspace. */
export const CMO_MAILING_LIST_NAME = "Newsletter";
export const CMO_MAILING_LIST_MAX = 5_000;
const BATCH = 100;
/** Longer lines are not a mailing-list row; skipping them keeps parsing linear. */
const MAX_LINE = 4_000;

export interface MailingListRow {
  email: string;
  name?: string;
}

/** The cells of one CSV line; quoted cells may hold the delimiter. */
function cells(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) {
      out.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  out.push(cell.trim());
  return out;
}

/** A whole cell as one address, "Ada <ada@example.com>" included; never a substring. */
function emailIn(cell: string): string | null {
  if (!cell.includes("@")) return null;
  const inner = /<([^<>]*)>$/.exec(cell)?.[1] ?? cell;
  return normalizeContactChannelValue("EMAIL", inner);
}

/**
 * The people in a pasted or exported mailing list: any CSV, or one address a
 * line. The email is the first cell that is an address; a column headed
 * "name" (or first and last name) gives the name.
 */
export function parseMailingList(text: string): MailingListRow[] {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && line.length <= MAX_LINE);
  const first = lines[0] ?? "";
  const delimiter =
    [",", ";", "\t"].find((candidate) => first.includes(candidate)) ?? ",";
  const header = first.includes("@")
    ? null
    : cells(first, delimiter).map((cell) => cell.toLowerCase());
  const column = (test: (name: string) => boolean) =>
    header ? header.findIndex(test) : -1;
  const nameAt = column((name) => name === "name" || name === "full name");
  const firstAt = column((name) => /^first.?name$/.test(name));
  const lastAt = column((name) => /^last.?name$/.test(name));
  const seen = new Set<string>();
  const rows: MailingListRow[] = [];
  for (const line of header ? lines.slice(1) : lines) {
    const row = cells(line, delimiter);
    const email = row.map(emailIn).find(Boolean);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const name =
      (nameAt >= 0 ? row[nameAt] : undefined) ||
      [firstAt >= 0 ? row[firstAt] : "", lastAt >= 0 ? row[lastAt] : ""]
        .join(" ")
        .trim() ||
      undefined;
    rows.push({ email, name: name?.slice(0, 200) });
  }
  return rows;
}

/**
 * The hire's owner may still write to its workspace: they own the personal
 * workspace, or are still a member of its organization.
 */
async function requireWorkspaceAccess(
  hire: Pick<CmoHire, "userId" | "workspaceId">,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: hire.workspaceId },
    select: { userId: true, organizationId: true },
  });
  const allowed = workspace?.organizationId
    ? await prisma.member.findUnique({
        where: {
          userId_organizationId: {
            userId: hire.userId,
            organizationId: workspace.organizationId,
          },
        },
        select: { id: true },
      })
    : workspace?.userId === hire.userId;
  if (!allowed) throw forbidden("Workspace membership required");
  // Contacts in an organization need a product seat, as on the Contacts page.
  if (workspace?.organizationId) {
    await requireAssignedOrganizationSeat(
      hire.userId,
      workspace.organizationId,
    );
  }
}

/** Adds a mailing list to the CMO workspace's newsletter list. */
export async function importCmoMailingList(
  hire: Pick<CmoHire, "userId" | "workspaceId">,
  text: string,
): Promise<{ added: number; total: number }> {
  await requireWorkspaceAccess(hire);
  const rows = parseMailingList(text);
  if (rows.length === 0) {
    throw unprocessableEntity("No email addresses found in that file");
  }
  if (rows.length > CMO_MAILING_LIST_MAX) {
    throw unprocessableEntity(
      `A list can have at most ${CMO_MAILING_LIST_MAX} addresses for now`,
    );
  }
  const actor: ContactActor = {
    workspaceId: hire.workspaceId,
    userId: hire.userId,
    sokoBotId: null,
  };
  const list = await inContactTransaction((tx) =>
    ensureManualContactList(tx, actor, CMO_MAILING_LIST_NAME, "blue"),
  );
  let added = 0;
  for (let start = 0; start < rows.length; start += BATCH) {
    added += await inContactTransaction(async (tx) => {
      let joined = 0;
      for (const row of rows.slice(start, start + BATCH)) {
        const { contact } = await upsertContact(
          tx,
          actor,
          {
            name: row.name,
            channels: [{ type: "EMAIL", value: row.email, source: "IMPORT" }],
            upsert: true,
          },
          { defaultChannelSource: "IMPORT" },
        );
        const member = await tx.contactListMember.createMany({
          data: [
            {
              listId: list.id,
              contactId: contact.id,
              addedByUserId: hire.userId,
            },
          ],
          skipDuplicates: true,
        });
        joined += member.count;
      }
      return joined;
    });
  }
  return { added, total: await cmoMailingListSize(hire) };
}

/** How many people are on the newsletter list. */
export async function cmoMailingListSize(
  hire: Pick<CmoHire, "workspaceId">,
): Promise<number> {
  return prisma.contactListMember.count({
    where: {
      list: {
        workspaceId: hire.workspaceId,
        nameKey: contactListNameKey(CMO_MAILING_LIST_NAME),
      },
      contact: { mergedIntoId: null },
    },
  });
}

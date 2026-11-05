import { normalizeContactChannelValue } from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error";
import {
  type ContactListDto,
  updateContactListMembers,
} from "@/services/contact-lists.service";
import {
  type ContactActor,
  inContactTransaction,
  upsertContact,
} from "@/services/contacts.service";

export const CONTACT_LIST_TEXT_IMPORT_MAX = 5_000;
const BATCH = 100;
/** Longer lines are not a list row; skipping them keeps parsing linear. */
const MAX_LINE = 4_000;

export interface ContactListTextRow {
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
 * The people in a pasted or exported list: any CSV, or one address a
 * line. The email is the first cell that is an address; a column headed
 * "name" (or first and last name) gives the name.
 */
export function parseContactListText(text: string): ContactListTextRow[] {
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
  const rows: ContactListTextRow[] = [];
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
 * Adds the people in a pasted list to a manual contact list: each address
 * becomes a contact (or matches one) and joins the list.
 */
export async function importContactListText(
  actor: ContactActor,
  listId: string,
  text: string,
): Promise<ContactListDto> {
  const rows = parseContactListText(text);
  if (rows.length === 0) {
    throw unprocessableEntity("No email addresses found in that text");
  }
  if (rows.length > CONTACT_LIST_TEXT_IMPORT_MAX) {
    throw unprocessableEntity(
      `A list can have at most ${CONTACT_LIST_TEXT_IMPORT_MAX} addresses for now`,
    );
  }
  let list: ContactListDto | undefined;
  for (let start = 0; start < rows.length; start += BATCH) {
    list = await inContactTransaction(async (tx) => {
      const add: string[] = [];
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
        add.push(contact.id);
      }
      // Checks the list (this workspace's, manual) in the same transaction.
      return updateContactListMembers(tx, actor, listId, { add, remove: [] });
    });
  }
  // At least one batch ran: rows is never empty here.
  return list as ContactListDto;
}

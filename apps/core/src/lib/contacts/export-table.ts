/**
 * Contacts as rows of a Files table, for `export_contacts_to_table`: the
 * fields people work through in a sheet, one column each.
 */
import { createHash } from "node:crypto";

import type {
  tableColumnInputSchema,
  tableInsertRowSchema,
} from "@sokosumi/utils";
import type { z } from "zod";
import type { listContacts } from "@/services/contacts.service";

type Contact = Awaited<ReturnType<typeof listContacts>>["items"][number];

const COLUMNS = [
  { name: "Name", type: "text" },
  {
    id: "0b1f8a52-1d3e-4c0a-9a1e-000000000002",
    name: "Organization",
    type: "text",
  },
  { name: "Role", type: "text" },
  {
    id: "0b1f8a52-1d3e-4c0a-9a1e-000000000004",
    name: "Location",
    type: "text",
  },
  { name: "Stage", type: "text" },
  { name: "Email", type: "email" },
  { name: "Phone", type: "text" },
  { name: "LinkedIn", type: "url" },
  { name: "X", type: "text" },
  {
    id: "0b1f8a52-1d3e-4c0a-9a1e-00000000000a",
    name: "X followers",
    type: "number",
  },
  {
    id: "0b1f8a52-1d3e-4c0a-9a1e-00000000000b",
    name: "Last contact",
    type: "date",
  },
  {
    id: "0b1f8a52-1d3e-4c0a-9a1e-00000000000c",
    name: "Lists",
    type: "long_text",
  },
] as const;

type Key = (typeof COLUMNS)[number]["name"];

function row(contact: Contact): Record<Key, string | number | null> {
  const channel = (type: string) =>
    contact.channels.find((each) => each.type === type) ?? null;
  const x = channel("X");
  return {
    Name: contact.name,
    Organization: contact.organization,
    Role: contact.role,
    Location: contact.location,
    Stage: contact.stage,
    Email: channel("EMAIL")?.value ?? null,
    Phone: channel("PHONE")?.value ?? null,
    LinkedIn: channel("LINKEDIN")?.value ?? null,
    X: x ? `@${x.value}` : null,
    "X followers": x?.followers ?? null,
    "Last contact": contact.lastContactAt
      ? new Date(contact.lastContactAt as Date | string)
          .toISOString()
          .slice(0, 10)
      : null,
    Lists: contact.lists.map((list) => list.name).join(", ") || null,
  };
}

/**
 * A column id of its own per export (column ids are unique across all
 * tables), the same on every retry of that export.
 */
function columnId(seed: string, name: string): string {
  const hex = createHash("sha256").update(`${seed}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function contactExportTable(
  contacts: readonly Contact[],
  seed: string,
): {
  columns: z.infer<typeof tableColumnInputSchema>[];
  rows: z.infer<typeof tableInsertRowSchema>[];
} {
  return {
    columns: COLUMNS.map((column) => ({
      ...column,
      id: columnId(seed, column.name),
      description: "",
      options: [],
    })),
    rows: contacts.map((contact) => {
      const values = row(contact);
      const cells: Record<string, string | number | null> = {};
      for (const column of COLUMNS)
        cells[columnId(seed, column.name)] = values[column.name];
      return { values: cells, evidence: {} };
    }),
  };
}

import { parseTableCsv } from "@sokosumi/utils";

import { unprocessableEntity } from "@/helpers/error";
import { newsletterEmailSchema } from "@/schemas/newsletter.schema";

export function parseNewsletterCsv(csv: string) {
  let rows: string[][];
  try {
    rows = parseTableCsv(csv, { maxRows: 50_000 });
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid CSV",
    );
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const emailIndex = headers.findIndex((header) =>
    ["email", "e-mail", "email address"].includes(header),
  );
  if (emailIndex < 0) {
    throw unprocessableEntity("CSV needs an email column");
  }
  const nameIndex = headers.findIndex((header) =>
    ["name", "full name"].includes(header),
  );
  const subscribers = new Map<string, { email: string; name: string | null }>();
  const invalid: { row: number; value: string }[] = [];
  let validRows = 0;

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    const email = newsletterEmailSchema.safeParse(row[emailIndex]);
    if (!email.success) {
      if (invalid.length < 100) {
        invalid.push({ row: index + 1, value: row[emailIndex] });
      }
      continue;
    }
    validRows++;
    if (!subscribers.has(email.data)) {
      subscribers.set(email.data, {
        email: email.data,
        name: nameIndex >= 0 ? row[nameIndex].trim() || null : null,
      });
    }
  }

  return { subscribers: [...subscribers.values()], validRows, invalid };
}

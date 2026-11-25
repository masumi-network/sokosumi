import { parseArgs } from "node:util";
import { Prisma } from "../generated/prisma/client.js";
import { sharedTable } from "../sql-tables.js";

export interface RequeueEmptyCompanyLookupsOptions {
  before: Date;
  apply?: boolean;
}

export function parseRequeueEmptyCompanyLookupsArgs(
  argv: readonly string[],
  now = Date.now(),
): { before: Date; apply: boolean } {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== "--"),
    options: { before: { type: "string" }, apply: { type: "boolean" } },
  });
  const before = new Date(values.before ?? "");
  if (
    !values.before?.endsWith("Z") ||
    !Number.isFinite(before.getTime()) ||
    before.getTime() > now
  ) {
    throw new Error(
      "Pass the Core cutover as a past UTC timestamp with --before.",
    );
  }
  return { before, apply: values.apply === true };
}

export async function requeueEmptyCompanyLookups(
  db: Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">,
  { before, apply = false }: RequeueEmptyCompanyLookupsOptions,
): Promise<number> {
  const matches = Prisma.sql`
    "enrichedAt" < (${before}::timestamptz AT TIME ZONE 'UTC')
    AND description IS NULL
    AND industry IS NULL
    AND size IS NULL
    AND headquarters IS NULL
  `;
  if (apply) {
    return db.$executeRaw`
      UPDATE ${sharedTable("contact_company")}
      SET "enrichedAt" = NULL, "lookupFailures" = 0
      WHERE ${matches}
    `;
  }
  const [row] = await db.$queryRaw<[{ count: bigint }]>`
    SELECT count(*) AS count FROM ${sharedTable("contact_company")} WHERE ${matches}
  `;
  return Number(row.count);
}

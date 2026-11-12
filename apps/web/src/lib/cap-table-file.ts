import { z } from "zod";

/**
 * A cap table: who holds the company's shares and what is reserved for the
 * stock plan, as JSON named `*.captable.json`. Drive and data rooms render it
 * as an ownership table instead of raw JSON.
 */
export const CAP_TABLE_FILE_SUFFIX = ".captable.json";

const holderSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  shareClass: z.string().min(1),
  shares: z.number().int().positive(),
  vesting: z.string().optional(),
});

const poolSchema = z.object({
  name: z.string().min(1),
  reserved: z.number().int().positive(),
  granted: z.number().int().nonnegative().default(0),
});

const capTableSchema = z.object({
  kind: z.literal("sokosumi.cap-table"),
  version: z.literal(1),
  company: z.string().min(1),
  /** ISO date the table is true as of. */
  asOf: z.iso.date(),
  authorizedShares: z.number().int().positive().optional(),
  parValue: z.string().optional(),
  note: z.string().optional(),
  holders: z.array(holderSchema).min(1),
  pools: z.array(poolSchema).default([]),
});

export type CapTable = z.infer<typeof capTableSchema>;

export function isCapTableFileName(name: string): boolean {
  return name.toLowerCase().endsWith(CAP_TABLE_FILE_SUFFIX);
}

export function parseCapTable(json: unknown): CapTable | null {
  const parsed = capTableSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export interface CapTableRow {
  name: string;
  role?: string;
  vesting?: string;
  /** The holder's class; absent for a pool. */
  shareClass?: string;
  shares: number;
  /** Granted out of a pool's reserve. */
  granted?: number;
  /** Share of issued stock; null for a pool, which is not issued. */
  issued: number | null;
  fullyDiluted: number;
  pool: boolean;
}

/**
 * Ownership, issued and fully diluted. Fully diluted counts every share a
 * pool reserves, granted or not, as investors read it.
 */
export function capTableRows(table: CapTable): {
  rows: CapTableRow[];
  issuedShares: number;
  fullyDilutedShares: number;
} {
  const issuedShares = table.holders.reduce((sum, h) => sum + h.shares, 0);
  const fullyDilutedShares =
    issuedShares + table.pools.reduce((sum, p) => sum + p.reserved, 0);
  const rows: CapTableRow[] = [
    ...table.holders.map((holder) => ({
      name: holder.name,
      role: holder.role,
      vesting: holder.vesting,
      shareClass: holder.shareClass,
      shares: holder.shares,
      issued: holder.shares / issuedShares,
      fullyDiluted: holder.shares / fullyDilutedShares,
      pool: false,
    })),
    ...table.pools.map((pool) => ({
      name: pool.name,
      shares: pool.reserved,
      granted: pool.granted,
      issued: null,
      fullyDiluted: pool.reserved / fullyDilutedShares,
      pool: true,
    })),
  ];
  return { rows, issuedShares, fullyDilutedShares };
}

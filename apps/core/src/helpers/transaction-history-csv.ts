import { convertCentsToCredits } from "@sokosumi/utils";

import { loadAgentPreviewsByIds } from "@/helpers/history";
import {
  type BuildTransactionHistoryParams,
  findTransactionHistoryPage,
  mapTransactionHistoryRow,
  type TransactionHistoryPrismaClient,
} from "@/helpers/transaction-history";
import type prisma from "@/lib/db/prisma";

const PAGE_SIZE = 1000;

const TRANSACTION_CSV_HEADER = "date,source,label,credits";

/**
 * One CSV field. Quoted when it holds a separator, quote or line break, with
 * quotes doubled (RFC 4180).
 */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Ledger units are 10^-10 credits; four decimals is more than any bill shows. */
function formatCredits(credits: number): string {
  return String(Number(credits.toFixed(4)));
}

/**
 * A label is user text. One that starts with `= + - @` would run as a formula
 * in a spreadsheet, so it gets a leading apostrophe. Numbers do not go through
 * here: `-2` is a credit amount, not a formula.
 */
export function csvLabel(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvRow(fields: string[]): string {
  return `${fields.map(csvField).join(",")}\r\n`;
}

/**
 * Streams every ledger row in range as CSV, newest first, one keyset page at a
 * time so the largest account (~70k rows) never sits in memory. The last three
 * rows are totals in the same four columns, `source` = `total`, so the file
 * stays a plain table.
 */
export function streamTransactionCsv(
  params: BuildTransactionHistoryParams,
  prismaClient: TransactionHistoryPrismaClient & Pick<typeof prisma, "agent">,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let done = false;
  let started = false;
  let spent = 0n;
  let topUps = 0n;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(`${TRANSACTION_CSV_HEADER}\r\n`));
      }

      if (done) {
        const net = topUps - spent;
        const total = (label: string, cents: bigint, sign: 1 | -1) =>
          csvRow([
            "",
            "total",
            label,
            formatCredits(sign * convertCentsToCredits(cents)),
          ]);
        controller.enqueue(
          encoder.encode(
            total("Spent", spent, -1) +
              total("Top ups", topUps, 1) +
              total("Net", net < 0n ? -net : net, net < 0n ? -1 : 1),
          ),
        );
        controller.close();
        return;
      }

      const { rows, hasMore } = await findTransactionHistoryPage(
        params,
        { cursor, take: PAGE_SIZE },
        prismaClient,
      );
      const agentIds = [
        ...new Set(
          rows
            .map((row) => row.agentId)
            .filter((agentId): agentId is string => agentId != null),
        ),
      ];
      const agentPreviewById = await loadAgentPreviewsByIds(
        agentIds,
        prismaClient,
      );

      let chunk = "";
      for (const row of rows) {
        const item = mapTransactionHistoryRow(row, { agentPreviewById });
        const isTopUp = item.kind === "topUp";
        if (isTopUp) topUps += row.amount;
        else spent += -row.amount;
        chunk += csvRow([
          row.consumedAt.toISOString(),
          item.kind,
          csvLabel(item.title),
          formatCredits(isTopUp ? item.credits : -item.credits),
        ]);
      }
      controller.enqueue(encoder.encode(chunk));

      cursor = rows.at(-1)?.id;
      done = !hasMore || cursor === undefined;
    },
  });
}

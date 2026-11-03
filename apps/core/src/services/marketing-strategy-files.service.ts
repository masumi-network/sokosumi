import type { MarketingStrategy } from "@sokosumi/database";
import type { CmoCalendarEntry } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import {
  type CusoDrive,
  saveCusoProjectFile,
} from "@/services/cuso-project-files.service";
import { downloadBlob } from "@/services/file-index.service";
import {
  entryMedia,
  isMarketingFilePiece,
} from "@/services/marketing-strategy.service";

/**
 * The pieces of an approved Marketing strategy that are not Social posts (an
 * article, a page fix, ad copy, a newsletter issue) are written as the
 * Project's Files (ADR 0062): the owner pastes, launches or sends them. Each
 * one is linked to its version and calendar entry, so the month is read from
 * the files the way social pieces are read from their posts.
 */

/** Where the pieces land in the Project's Files, by month. */
export const MARKETING_FILES_FOLDER = "Marketing";

function monthFolder(date: string): string {
  const month = new Date(`${date}T12:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${MARKETING_FILES_FOLDER}/${month}`;
}

/** A filename the Drive takes: no path separators or reserved characters. */
function pieceFilename(entry: Pick<CmoCalendarEntry, "date" | "title">) {
  const title = entry.title
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim()
    .slice(0, 120);
  return `${entry.date} ${title}.md`;
}

/** The file holds the piece as the owner uses it: its title, then its words. */
export function marketingPieceMarkdown(
  entry: Pick<CmoCalendarEntry, "title" | "draft">,
): string {
  return `# ${entry.title}\n\n${(entry.draft ?? "").trim()}\n`;
}

/** The words of a piece's file, without the title line it starts with. */
export function marketingPieceText(markdown: string): string {
  return markdown.replace(/^# [^\n]*\n+/, "").trim();
}

/**
 * Writes each sent piece that is not a Social post as the version's file:
 * a new piece with its words gets a file under Marketing/<month>, a piece
 * with a file is rewritten in place, and the pictures a save names are kept
 * on its link (a save may send only the picture). Returns how many pieces
 * were written.
 */
export async function writeMarketingStrategyFiles(input: {
  version: Pick<MarketingStrategy, "id">;
  drive: CusoDrive;
  entries: CmoCalendarEntry[];
}): Promise<number> {
  const pieces = input.entries.filter(
    (entry) =>
      isMarketingFilePiece(entry) &&
      entry.status !== "skipped" &&
      (Boolean(entry.draft?.trim()) ||
        entryMedia(entry).length > 0 ||
        Boolean(entry.searchAd)),
  );
  if (pieces.length === 0) return 0;
  const links = await prisma.marketingStrategyFile.findMany({
    where: {
      marketingStrategyId: input.version.id,
      entryId: { in: pieces.map((entry) => entry.id) },
    },
    select: {
      entryId: true,
      fileResource: { select: { sourceId: true, displayName: true } },
    },
  });
  let written = 0;
  for (const entry of pieces) {
    const link = links.find((item) => item.entryId === entry.id);
    const media = entryMedia(entry);
    // A search ad's parts ride along with its words; Core launches from them.
    const searchAd = entry.searchAd ? { searchAd: entry.searchAd } : {};
    if (!entry.draft?.trim()) {
      // Only pictures or ad parts: they join a piece already written.
      if (!link) continue;
      await prisma.marketingStrategyFile.update({
        where: {
          marketingStrategyId_entryId: {
            marketingStrategyId: input.version.id,
            entryId: entry.id,
          },
        },
        data: {
          ...(media.length > 0 ? { mediaFileIds: media } : {}),
          ...searchAd,
        },
      });
      written += 1;
      continue;
    }
    const fileId = await saveCusoProjectFile(
      input.drive,
      link
        ? {
            pathname: link.fileResource.sourceId,
            filename: link.fileResource.displayName,
          }
        : { folder: monthFolder(entry.date), filename: pieceFilename(entry) },
      Buffer.from(marketingPieceMarkdown(entry)),
      "text/markdown",
    );
    if (!fileId) continue;
    await prisma.marketingStrategyFile.upsert({
      where: {
        marketingStrategyId_entryId: {
          marketingStrategyId: input.version.id,
          entryId: entry.id,
        },
      },
      create: {
        marketingStrategyId: input.version.id,
        entryId: entry.id,
        fileResourceId: fileId,
        mediaFileIds: media,
        ...searchAd,
      },
      update: {
        fileResourceId: fileId,
        ...(media.length > 0 ? { mediaFileIds: media } : {}),
        ...searchAd,
      },
    });
    written += 1;
  }
  return written;
}

/** The words of one written piece, or null when it has no file yet. */
export async function readMarketingPieceText(
  version: Pick<MarketingStrategy, "id">,
  entryId: string,
): Promise<string | null> {
  const link = await prisma.marketingStrategyFile.findUnique({
    where: {
      marketingStrategyId_entryId: {
        marketingStrategyId: version.id,
        entryId,
      },
    },
    select: { fileResource: { select: { sourceId: true, lifecycle: true } } },
  });
  if (!link || link.fileResource.lifecycle !== "ACTIVE") return null;
  const bytes = await downloadBlob(link.fileResource.sourceId);
  return bytes ? marketingPieceText(new TextDecoder().decode(bytes)) : null;
}

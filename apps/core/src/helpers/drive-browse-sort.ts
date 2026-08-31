import { createHmac, timingSafeEqual } from "node:crypto";

import {
  driveFileTypeFamily,
  driveFileTypeFamilyRank,
} from "@/helpers/drive-file-type-family";
import { badRequest } from "@/helpers/error";
import type { DriveItem } from "@/schemas/drive-file.schema";
import type { DriveListSort } from "@/schemas/drive-list-sort.schema";

const BROWSE_SORT_CURSOR_VERSION = 1;

interface BrowseSortCursorPayload {
  v: typeof BROWSE_SORT_CURSOR_VERSION;
  itemType: "folder" | "file";
  name: string;
  pathname: string | null;
  uploadedAt: string | null;
}

export interface DriveBrowseSortCursorBinding {
  prefix: string;
  searchQuery: string;
  sortBy: DriveListSort["sortBy"];
  sortOrder: DriveListSort["sortOrder"];
}

function browseItemId(item: DriveItem): string {
  if (item.type === "folder") {
    return `folder:${item.name}`;
  }
  return `file:${item.pathname}`;
}

function directionFactor(order: DriveListSort["sortOrder"]): number {
  return order === "asc" ? 1 : -1;
}

/**
 * Folders always lead; within each bucket apply the chosen key.
 * Default (name asc) matches today's Browse omit behavior.
 */
export function compareDriveBrowseItems(
  left: DriveItem,
  right: DriveItem,
  sort: DriveListSort,
): number {
  if (left.type !== right.type) {
    return left.type === "folder" ? -1 : 1;
  }

  const dir = directionFactor(sort.sortOrder);

  if (sort.sortBy === "name") {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName * dir;
    }
  } else if (sort.sortBy === "date") {
    const leftTime =
      left.type === "file"
        ? Date.parse(left.uploadedAt)
        : Number.NEGATIVE_INFINITY;
    const rightTime =
      right.type === "file"
        ? Date.parse(right.uploadedAt)
        : Number.NEGATIVE_INFINITY;
    if (leftTime !== rightTime) {
      return (leftTime - rightTime) * dir;
    }
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }
  } else {
    // type — folders share one bucket already; files by family then name
    if (left.type === "file" && right.type === "file") {
      const leftFamily = driveFileTypeFamily(left.name);
      const rightFamily = driveFileTypeFamily(right.name);
      if (leftFamily !== rightFamily) {
        return (
          (driveFileTypeFamilyRank(leftFamily) -
            driveFileTypeFamilyRank(rightFamily)) *
          dir
        );
      }
    }
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName * dir;
    }
  }

  return browseItemId(left).localeCompare(browseItemId(right));
}

export function sortDriveBrowseItems(
  items: DriveItem[],
  sort: DriveListSort,
): DriveItem[] {
  return [...items].sort((a, b) => compareDriveBrowseItems(a, b, sort));
}

function signBrowseCursor(
  payload: BrowseSortCursorPayload,
  secret: string,
  binding: DriveBrowseSortCursorBinding,
): string {
  const payloadJson = JSON.stringify(payload);
  const bindingJson = JSON.stringify(binding);
  const signature = createHmac("sha256", secret)
    .update(bindingJson)
    .update("\0")
    .update(payloadJson)
    .digest("base64url");

  return Buffer.from(
    JSON.stringify({ payload: payloadJson, signature }),
    "utf8",
  ).toString("base64url");
}

function verifyBrowseCursor(
  payloadJson: string,
  signature: string,
  secret: string,
  binding: DriveBrowseSortCursorBinding,
): void {
  const bindingJson = JSON.stringify(binding);
  const expected = createHmac("sha256", secret)
    .update(bindingJson)
    .update("\0")
    .update(payloadJson)
    .digest("base64url");

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    signatureBuf.length !== expectedBuf.length ||
    !timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    throw badRequest("Invalid pagination cursor");
  }
}

export function encodeDriveBrowseSortCursor(input: {
  lastItem: DriveItem;
  cursorSecret: string;
  cursorBinding: DriveBrowseSortCursorBinding;
}): string {
  const payload: BrowseSortCursorPayload = {
    v: BROWSE_SORT_CURSOR_VERSION,
    itemType: input.lastItem.type,
    name: input.lastItem.name,
    pathname: input.lastItem.type === "file" ? input.lastItem.pathname : null,
    uploadedAt:
      input.lastItem.type === "file" ? input.lastItem.uploadedAt : null,
  };

  return signBrowseCursor(payload, input.cursorSecret, input.cursorBinding);
}

function lastItemFromBrowseCursor(payload: BrowseSortCursorPayload): DriveItem {
  if (payload.itemType === "folder") {
    return {
      type: "folder",
      name: payload.name,
      path: payload.name,
    };
  }

  return {
    type: "file",
    name: payload.name,
    fileUrl: "https://example.com/placeholder",
    pathname: payload.pathname ?? payload.name,
    size: 0,
    uploadedAt: payload.uploadedAt ?? new Date(0).toISOString(),
  };
}

export function decodeDriveBrowseSortCursor(
  cursor: string,
  input: {
    cursorSecret: string;
    cursorBinding: DriveBrowseSortCursorBinding;
  },
): DriveItem {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const envelope = JSON.parse(decoded) as {
      payload?: string;
      signature?: string;
    };

    if (!envelope.payload || !envelope.signature) {
      throw badRequest("Invalid pagination cursor");
    }

    verifyBrowseCursor(
      envelope.payload,
      envelope.signature,
      input.cursorSecret,
      input.cursorBinding,
    );

    const payload = JSON.parse(envelope.payload) as BrowseSortCursorPayload;
    if (payload.v !== BROWSE_SORT_CURSOR_VERSION || !payload.itemType) {
      throw badRequest("Invalid pagination cursor");
    }

    return lastItemFromBrowseCursor(payload);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Invalid pagination cursor"
    ) {
      throw error;
    }
    throw badRequest("Invalid pagination cursor");
  }
}

/**
 * Paginate a fully sorted Browse list after an optional cursor boundary.
 */
export function paginateSortedDriveBrowseItems(input: {
  items: DriveItem[];
  sort: DriveListSort;
  limit: number;
  cursor?: string;
  cursorSecret: string;
  cursorBinding: DriveBrowseSortCursorBinding;
}): {
  page: DriveItem[];
  nextCursor: string | null;
} {
  let startIndex = 0;
  if (input.cursor) {
    const cursorItem = decodeDriveBrowseSortCursor(input.cursor, {
      cursorSecret: input.cursorSecret,
      cursorBinding: input.cursorBinding,
    });
    const cursorIndex = input.items.findIndex(
      (item) => browseItemId(item) === browseItemId(cursorItem),
    );
    if (cursorIndex < 0) {
      throw badRequest("Invalid pagination cursor");
    }
    startIndex = cursorIndex + 1;
  }

  const page = input.items.slice(startIndex, startIndex + input.limit);
  const hasMore = startIndex + input.limit < input.items.length;
  const lastItem = page[page.length - 1] ?? null;

  return {
    page,
    nextCursor:
      hasMore && lastItem
        ? encodeDriveBrowseSortCursor({
            lastItem,
            cursorSecret: input.cursorSecret,
            cursorBinding: input.cursorBinding,
          })
        : null,
  };
}

import { randomUUID } from "node:crypto";
import { sanitizeFileName } from "@sokosumi/utils";
import { list, put } from "@vercel/blob";
import { getEnv } from "@/config/env";
import { serviceUnavailable } from "@/helpers/error";

function storageToken() {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token)
    throw serviceUnavailable(
      "Sticker storage is unavailable. Try again later.",
    );
  return token;
}

// Separate from general user-upload grants: only validated sticker bytes enter this prefix.
function stickerPrefix(userId: string) {
  return `stickers/${encodeURIComponent(userId)}/`;
}

export async function listChatStickers(userId: string) {
  const stickers: { url: string; name: string }[] = [];
  const token = storageToken();
  for (let cursor: string | undefined; ; ) {
    const page = await list({ prefix: stickerPrefix(userId), cursor, token });
    stickers.push(
      ...page.blobs.map((blob) => ({
        url: blob.url,
        name: blob.pathname.split("/").at(-1) ?? "sticker",
      })),
    );
    if (!page.hasMore) return stickers;
    if (!page.cursor)
      throw serviceUnavailable("Unable to load stickers. Try again.");
    cursor = page.cursor;
  }
}

export async function saveChatSticker(
  userId: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
) {
  const extension =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/webp"
        ? "webp"
        : "png";
  const stem =
    sanitizeFileName(filename.replace(/\.[^.]*$/, "")).slice(0, 100) ||
    "sticker";
  const name = `${stem}.${extension}`;
  const blob = await put(
    `${stickerPrefix(userId)}${randomUUID()}/${name}`,
    bytes,
    {
      access: "public",
      contentType,
      addRandomSuffix: false,
      token: storageToken(),
    },
  );
  return { url: blob.url, name };
}

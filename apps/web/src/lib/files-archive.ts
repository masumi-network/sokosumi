export const MAX_ARCHIVE_FILES = 50;
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

export interface ArchiveFile {
  name: string;
  fileUrl: string;
  /** Folder inside the zip, `/`-separated; the root when absent. */
  folder?: string;
}

export interface FilesArchive {
  /** Null when no file could be added. */
  data: ArrayBuffer | null;
  /** Names, with their folder when they have one. */
  included: string[];
  /** Names of files left out: failed to load, over the count or the size limit. */
  missing: string[];
}

/** Windows device names: `CON.txt` cannot be unpacked there, whatever the extension. */
const WINDOWS_RESERVED_NAME =
  /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i;

/**
 * A name that unpacks as written on every system: no path separators, control
 * characters or characters Windows rejects, no trailing dots or spaces (Windows
 * drops them, so `report.` would land on `report`) and no device names.
 */
export function safeFileName(name: string, fallback: string): string {
  const safe = name
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "-")
    .trim()
    .replace(/[. ]+$/, "");
  // Also covers "." and "..", which would point outside the zip folder.
  if (!safe) return fallback;
  return WINDOWS_RESERVED_NAME.test(safe) ? `_${safe}` : safe;
}

/** `Report.pdf`, `Report (2).pdf`: zip entries need distinct names within their folder. */
export function uniqueArchiveName(
  name: string,
  taken: Set<string>,
  folder = "",
): string {
  const prefix = folder ? `${folder}/` : "";
  const safe = safeFileName(name, "file");
  const dot = safe.lastIndexOf(".");
  const [base, ext] =
    dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
  let candidate = safe;
  for (let n = 2; taken.has(`${prefix}${candidate}`.toLowerCase()); n++) {
    candidate = `${base} (${n})${ext}`;
  }
  taken.add(`${prefix}${candidate}`.toLowerCase());
  return `${prefix}${candidate}`;
}

/** Each segment made safe on its own, so a folder can never climb out of the zip. */
function safeFolderPath(folder: string): string {
  return folder
    .split("/")
    .filter(Boolean)
    .map((segment) => safeFileName(segment, "folder"))
    .join("/");
}

/** Saves zip bytes as `<name>.zip` through the browser's download. */
export function saveZip(data: ArrayBuffer, name: string): void {
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(name, "files")}.zip`;
  link.click();
  // Allow the browser to begin saving before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * The response body, or null once it passes `budget` bytes. A declared
 * length over budget is refused unread; otherwise reading stops at the first
 * chunk past it, so an oversized file is never held in memory.
 */
export async function readWithinBudget(
  response: Response,
  budget: number,
): Promise<Blob | null> {
  if (Number(response.headers.get("content-length")) > budget) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return new Blob([]);
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks);
    bytes += value.byteLength;
    if (bytes > budget) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

export async function createFilesArchive(
  files: ArchiveFile[],
  signal?: AbortSignal,
  maxBytes = MAX_ARCHIVE_BYTES,
  maxFiles = MAX_ARCHIVE_FILES,
): Promise<FilesArchive> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const taken = new Set<string>();
  const included: string[] = [];
  const missing: string[] = [];
  let bytes = 0;

  // One file at a time keeps memory and simultaneous requests bounded.
  for (const file of files) {
    const label = file.folder ? `${file.folder}/${file.name}` : file.name;
    if (included.length >= maxFiles) {
      missing.push(label);
      continue;
    }
    try {
      const timeout = AbortSignal.timeout(60_000);
      const response = await fetch(file.fileUrl, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`File returned ${response.status}`);
      const blob = await readWithinBudget(response, maxBytes - bytes);
      if (!blob) {
        missing.push(label);
        continue;
      }
      bytes += blob.size;
      zip.file(
        uniqueArchiveName(file.name, taken, safeFolderPath(file.folder ?? "")),
        blob,
      );
      included.push(label);
    } catch (error) {
      if (signal?.aborted) throw error;
      missing.push(label);
    }
  }

  signal?.throwIfAborted();
  if (!included.length) return { data: null, included, missing };
  const data = await zip.generateAsync({
    type: "arraybuffer",
    streamFiles: true,
  });
  // ponytail: JSZip cannot stop mid-generation, so a cancel during it is honoured here, once it ends.
  signal?.throwIfAborted();
  return { data, included, missing };
}

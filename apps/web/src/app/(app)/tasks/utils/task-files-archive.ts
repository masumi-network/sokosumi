export const MAX_TASK_ARCHIVE_FILES = 50;
export const MAX_TASK_ARCHIVE_BYTES = 200 * 1024 * 1024;

export interface TaskArchiveFile {
  name: string;
  fileUrl: string;
}

export interface TaskFilesArchive {
  /** Null when no file could be added. */
  data: ArrayBuffer | null;
  included: string[];
  /** Names of files left out: failed to load, over the count or the size limit. */
  missing: string[];
}

/** A name without path separators, control characters or characters Windows rejects. */
export function safeFileName(name: string, fallback: string): string {
  const safe = name.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "-").trim();
  // "." and ".." would point outside the zip folder when unpacked.
  return /^\.*$/.test(safe) ? fallback : safe;
}

/** `Report.pdf`, `Report (2).pdf`: zip entries need distinct, path-free names. */
export function uniqueArchiveName(name: string, taken: Set<string>): string {
  const safe = safeFileName(name, "file");
  const dot = safe.lastIndexOf(".");
  const [base, ext] =
    dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
  let candidate = safe;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${base} (${n})${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export async function createTaskFilesArchive(
  files: TaskArchiveFile[],
  signal?: AbortSignal,
): Promise<TaskFilesArchive> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const taken = new Set<string>();
  const included: string[] = [];
  const missing: string[] = [];
  let bytes = 0;

  // One file at a time keeps memory and simultaneous requests bounded.
  for (const file of files) {
    if (included.length >= MAX_TASK_ARCHIVE_FILES) {
      missing.push(file.name);
      continue;
    }
    try {
      const timeout = AbortSignal.timeout(60_000);
      const response = await fetch(file.fileUrl, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`File returned ${response.status}`);
      const blob = await response.blob();
      if (bytes + blob.size > MAX_TASK_ARCHIVE_BYTES) {
        missing.push(file.name);
        continue;
      }
      bytes += blob.size;
      zip.file(uniqueArchiveName(file.name, taken), blob);
      included.push(file.name);
    } catch (error) {
      if (signal?.aborted) throw error;
      missing.push(file.name);
    }
  }

  return {
    data: included.length
      ? await zip.generateAsync({ type: "arraybuffer", streamFiles: true })
      : null,
    included,
    missing,
  };
}

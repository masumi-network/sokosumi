import type { ArchiveFile } from "@/lib/files-archive";

/** The link's own download route: it checks the link, its password and data rooms for every file. */
export function downloadHref(token: string, path?: string): string {
  const base = `/share/files/${encodeURIComponent(token)}/download`;
  return path ? `${base}?path=${encodeURIComponent(path)}` : base;
}

/** Each listed file through the link, its folders kept as paths in the zip. */
export function sharedFolderArchiveFiles(
  token: string,
  paths: string[],
): ArchiveFile[] {
  return paths.map((path) => {
    const slash = path.lastIndexOf("/");
    return {
      name: path.slice(slash + 1),
      fileUrl: downloadHref(token, path),
      ...(slash > 0 ? { folder: path.slice(0, slash) } : {}),
    };
  });
}

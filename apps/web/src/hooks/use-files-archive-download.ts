"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type ArchiveFile,
  createFilesArchive,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_FILES,
  saveZip,
} from "@/lib/files-archive";

const LISTED_MISSING_NAMES = 5;

/**
 * Builds a zip in the browser, saves it, and says which files were left out.
 * Resolves true once the folder was handled (zip saved, or nothing to zip).
 *
 * Next keeps a left page in Activity: its effects clean up but its state
 * stays, so a running download is cancelled and the button freed.
 */
export function useFilesArchiveDownload() {
  const t = useTranslations("Components.FilesArchive");
  const [downloading, setDownloading] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
      setDownloading(false);
    },
    [],
  );

  async function download(
    name: string,
    loadFiles: (signal: AbortSignal) => ArchiveFile[] | Promise<ArchiveFile[]>,
    maxFiles = MAX_ARCHIVE_FILES,
  ): Promise<boolean> {
    const controller = new AbortController();
    active.current = controller;
    setDownloading(true);
    try {
      const files = await loadFiles(controller.signal);
      if (files.length === 0) {
        if (controller.signal.aborted) return false;
        toast.info(t("empty"));
        return true;
      }
      const archive = await createFilesArchive(
        files,
        controller.signal,
        MAX_ARCHIVE_BYTES,
        maxFiles,
      );
      // Cancelled while the zip was being made: no file and no toast.
      if (controller.signal.aborted) return false;
      if (!archive.data) {
        toast.error(t("failed"));
        return false;
      }
      saveZip(archive.data, name);
      if (archive.missing.length > 0) {
        toast.warning(
          t("partial", {
            included: archive.included.length,
            total: files.length,
            names: archive.missing.slice(0, LISTED_MISSING_NAMES).join(", "),
            more: Math.max(0, archive.missing.length - LISTED_MISSING_NAMES),
          }),
          { duration: 15_000 },
        );
      }
      return true;
    } catch {
      if (!controller.signal.aborted) toast.error(t("failed"));
      return false;
    } finally {
      if (active.current === controller) {
        active.current = null;
        setDownloading(false);
      }
    }
  }

  return { downloading, download };
}

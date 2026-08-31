import { cookies } from "next/headers";
import { cache } from "react";
import {
  DEFAULT_FILES_VIEW_MODE,
  FILES_VIEW_MODE_COOKIE_NAME,
  type FilesViewMode,
  parseFilesViewMode,
} from "@/lib/ui-preferences/files-view-mode";

/** Cookie preference, else list. */
export const getDefaultFilesViewMode = cache(
  async (): Promise<FilesViewMode> => {
    const cookieStore = await cookies();
    return (
      parseFilesViewMode(cookieStore.get(FILES_VIEW_MODE_COOKIE_NAME)?.value) ??
      DEFAULT_FILES_VIEW_MODE
    );
  },
);

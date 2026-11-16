import { cookies, headers } from "next/headers";
import { userAgent } from "next/server";
import { cache } from "react";
import {
  parseTasksViewMode,
  preferTasksListFromDeviceType,
  resolveDefaultTasksViewMode,
  TASKS_VIEW_MODE_COOKIE_NAME,
  type TasksViewMode,
} from "@/lib/ui-preferences/tasks-view-mode";

/**
 * The view a link asks for, else cookie preference, else list on
 * mobile/tablet UA, else board.
 */
export const getDefaultTasksViewMode = cache(
  async (requested: TasksViewMode | null = null): Promise<TasksViewMode> => {
    const [cookieStore, headersList] = await Promise.all([
      cookies(),
      headers(),
    ]);
    const { device } = userAgent({ headers: headersList });

    return resolveDefaultTasksViewMode({
      requested,
      persisted: parseTasksViewMode(
        cookieStore.get(TASKS_VIEW_MODE_COOKIE_NAME)?.value,
      ),
      preferList: preferTasksListFromDeviceType(device.type),
    });
  },
);

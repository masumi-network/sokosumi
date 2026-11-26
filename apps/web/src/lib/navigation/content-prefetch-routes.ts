import { TASK_SCHEDULES_PATH } from "@/app/tasks/utils/task-schedule-view";

/**
 * List pages whose reads are all `"use cache: private"`, so a content
 * prefetch carries the page and not only its loading skeleton. Keep in step
 * with the sidebar rows that set `prefetchContent`.
 */
const CONTENT_PREFETCH_PATHS = new Set<string>([
  "/chat",
  "/projects",
  "/agents",
  "/tasks",
  TASK_SCHEDULES_PATH,
  "/calendar",
  "/studio",
  "/tiktok-studio",
  "/social",
  "/seo",
  "/ads",
]);

/** True when `href` (path plus optional query) is a content-prefetch page. */
export function canPrefetchRouteContent(href: string): boolean {
  const [pathname = ""] = href.split(/[?#]/, 1);
  return CONTENT_PREFETCH_PATHS.has(pathname);
}

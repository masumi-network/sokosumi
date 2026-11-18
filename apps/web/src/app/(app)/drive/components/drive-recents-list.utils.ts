import type { DriveRecentsItem } from "@sokosumi/core-client";
import { getDateGroupKey } from "@/lib/utils/datetime";

export interface DriveRecentsDayGroup {
  key: string;
  items: DriveRecentsItem[];
}

export function buildDriveRecentsDayGroups(
  items: DriveRecentsItem[],
  locale: string,
): DriveRecentsDayGroup[] {
  const sortedItems = [...items].sort(
    (first, second) =>
      new Date(second.activityAt).getTime() -
      new Date(first.activityAt).getTime(),
  );

  const groupsMap = new Map<string, DriveRecentsItem[]>();
  for (const item of sortedItems) {
    const groupKey =
      getDateGroupKey(new Date(item.activityAt).getTime(), locale) ?? "";
    const current = groupsMap.get(groupKey);
    if (current) {
      current.push(item);
    } else {
      groupsMap.set(groupKey, [item]);
    }
  }

  return Array.from(groupsMap, ([key, groupedItems]) => ({
    key,
    items: groupedItems,
  }));
}

/** `weekly.md` + "copy" → `weekly (copy).md`; no extension → appended. */
export function copyFileName(name: string, label: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)} (${label})${name.slice(dot)}`
    : `${name} (${label})`;
}

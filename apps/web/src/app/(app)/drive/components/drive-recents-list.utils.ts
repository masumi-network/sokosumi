import type { DriveRecentsItem } from "@/lib/clients/generated/core";
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

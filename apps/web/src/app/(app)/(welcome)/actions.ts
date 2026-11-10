"use server";

import { loadMyDay, type MyDayPage } from "./components/my-day";

/**
 * The next page of Home's My day: the same Core query, for the same day,
 * from `cursor`. Null on failure; the list says so and keeps its rows.
 */
export async function loadMoreMyDay({
  today,
  cursor,
}: {
  today: string;
  cursor: string;
}): Promise<MyDayPage | null> {
  return loadMyDay(today, cursor);
}

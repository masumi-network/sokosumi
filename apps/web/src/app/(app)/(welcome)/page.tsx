import { redirect } from "next/navigation";
import {
  CHAT_WELCOME_PATH,
  type NextSearchParamsRecord,
  pathWithSearch,
  toURLSearchParamsFromRecord,
} from "@/app/chat/utils/chat-route-base";

export default async function LegacyHomePage({
  searchParams,
}: {
  searchParams: Promise<NextSearchParamsRecord>;
}) {
  redirect(
    pathWithSearch(
      CHAT_WELCOME_PATH,
      toURLSearchParamsFromRecord(await searchParams),
    ),
  );
}

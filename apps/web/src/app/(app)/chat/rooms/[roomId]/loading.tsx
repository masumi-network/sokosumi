import DefaultLoading from "@/components/default-loading";

/**
 * Full-page spinner when opening a room. Room chrome is dynamic (header,
 * composer prefs, history) — Instant skeletons cannot match it without CLS.
 * Home/Chats/Search keep their own segment skeletons under Instant Nav.
 */
export default function ChatRoomLoading() {
  return <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />;
}

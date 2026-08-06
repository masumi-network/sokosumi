import DefaultLoading from "@/components/default-loading";

/**
 * Spinner when opening a room. Home/Chats/Search tab destinations use their
 * own segment `loading.tsx` skeletons under Instant Nav. Room open remains
 * a heavier navigation that uses this spinner shell.
 */
export default function ChatRoomLoading() {
  return <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />;
}

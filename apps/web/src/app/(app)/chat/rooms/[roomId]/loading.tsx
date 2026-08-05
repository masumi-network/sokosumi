import DefaultLoading from "@/components/default-loading";

/**
 * Spinner when opening a room. Home/Chats have no segment `loading.tsx` so
 * soft nav keeps the previous screen (Search-like). Room open is the heavier
 * navigation that still warrants an immediate loading state.
 */
export default function ChatRoomLoading() {
  return <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />;
}

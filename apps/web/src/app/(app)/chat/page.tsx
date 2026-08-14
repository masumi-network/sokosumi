import { redirect } from "next/navigation";

interface ChatPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Bare `/chat` redirects to Welcome at `/`, preserving searchParams
 * (`?dm=new`, `?create=channel`, `?notice=…`). Nested `/chat/chats` and
 * `/chat/rooms/...` are unchanged.
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        qs.append(key, entry);
      }
    } else {
      qs.set(key, value);
    }
  }
  const search = qs.toString();
  redirect(search.length > 0 ? `/?${search}` : "/");
}

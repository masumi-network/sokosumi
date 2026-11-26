import { isUuidString } from "@/lib/utils/uuid";

export interface ContactMentionTarget {
  id: string;
  workspaceId: string | null;
  origin: string | null;
}

/** Only a Contacts record URL can turn a Markdown link into a workspace read. */
export function contactMentionTarget(
  href: string | undefined,
): ContactMentionTarget | null {
  if (!href || !(href.startsWith("/contacts?") || /^https?:\/\//i.test(href)))
    return null;
  const relative = href.startsWith("/");
  let url: URL;
  try {
    url = new URL(href, "https://sokosumi.com");
  } catch {
    return null;
  }
  if (url.pathname !== "/contacts" || url.hash || url.username || url.password)
    return null;
  const params = url.searchParams;
  const id = params.get("contact");
  const workspaceId = params.get("workspace");
  if (
    !id ||
    !isUuidString(id) ||
    [...params].length !== (workspaceId === null ? 1 : 2) ||
    (workspaceId !== null && !isUuidString(workspaceId)) ||
    params.getAll("contact").length !== 1
  )
    return null;
  return {
    id: id.toLowerCase(),
    workspaceId: workspaceId?.toLowerCase() ?? null,
    origin: relative ? null : url.origin,
  };
}

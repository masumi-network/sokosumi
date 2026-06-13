export function buildSubscriptionStatusPath(
  returnPath: string,
  status: "cancel" | "success",
): string {
  const [pathname, queryString = ""] = returnPath.split("?");
  const searchParams = new URLSearchParams(queryString);
  searchParams.set("status", status);

  const nextQueryString = searchParams.toString();
  if (!nextQueryString) {
    return pathname;
  }

  return `${pathname}?${nextQueryString}`;
}

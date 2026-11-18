/** Read one cookie value from a raw Cookie header / `document.cookie` string. */
export function readCookieValue(
  cookieHeader: string,
  name: string,
): string | undefined {
  const prefix = `${name}=`;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trimStart())
    .find((part) => part.startsWith(prefix));

  return cookie?.slice(prefix.length);
}

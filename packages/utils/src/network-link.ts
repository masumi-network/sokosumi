export const NETWORK_QUERY_PARAM = "network";

export function withNetworkQuery(
  link: string,
  network?: "mainnet" | "preprod" | null,
): string {
  if (network == null) {
    return link;
  }
  if (network !== "mainnet" && network !== "preprod") {
    throw new RangeError("Expected the mainnet or preprod Network");
  }

  const fragmentIndex = link.indexOf("#");
  const pathAndQuery =
    fragmentIndex === -1 ? link : link.slice(0, fragmentIndex);
  const fragment = link.slice(pathAndQuery.length);
  const queryIndex = pathAndQuery.indexOf("?");
  const path =
    queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  const params = new URLSearchParams(pathAndQuery.slice(path.length));
  params.set(NETWORK_QUERY_PARAM, network);

  return `${path}?${params}${fragment}`;
}

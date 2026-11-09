/** Names as one phrase: "X", "X or LinkedIn", "X, LinkedIn or Facebook". */
export function joinNames(
  names: string[],
  joiner: "and" | "or" = "and",
): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}`;
}

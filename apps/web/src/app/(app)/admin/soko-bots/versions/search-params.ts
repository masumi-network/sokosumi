import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server";

export const loadCreateVersionSearchParams = createLoader({
  from: parseAsString,
});

export const loadVersionDetailSearchParams = createLoader({
  mode: parseAsStringLiteral(["edit"] as const),
});

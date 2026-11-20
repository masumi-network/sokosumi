import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";

import {
  GALLERY_AGENT_KINDS,
  GALLERY_SCOPES,
} from "@/lib/agents/gallery-filter";

export default function useGalleryFilter() {
  // One search for the whole Agents page: the hero field writes `query`, and
  // both the coworker gallery and the agent catalog filter by it.
  const [query, setQuery] = useQueryState("query", { defaultValue: "" });
  const [scope, setScope] = useQueryState(
    "show",
    parseAsStringLiteral(GALLERY_SCOPES).withDefault("all"),
  );
  const [categories, setCategories] = useQueryState(
    "categories",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [kind, setKind] = useQueryState(
    "kind",
    parseAsStringLiteral(GALLERY_AGENT_KINDS).withDefault("all"),
  );

  const resetFilters = () => {
    void setQuery("");
    void setCategories([]);
    void setKind("all");
  };

  return {
    query,
    scope,
    categories,
    kind,
    setQuery,
    setScope,
    setCategories,
    setKind,
    resetFilters,
  };
}

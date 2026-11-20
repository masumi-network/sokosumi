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
  // both the coworker gallery and the agent catalog filter by it. Links from
  // before the single search may carry the catalog's own `agentQuery`: the
  // catalog keeps filtering by it (and the field shows it when `query` is
  // empty) until the next edit writes one `query` for both.
  const [currentQuery, setCurrentQuery] = useQueryState("query", {
    defaultValue: "",
  });
  const [legacyQuery, setLegacyQuery] = useQueryState("agentQuery", {
    defaultValue: "",
  });
  const query = currentQuery || legacyQuery;
  const catalogQuery = legacyQuery || currentQuery;
  const setQuery = (value: string) => {
    void setLegacyQuery(null);
    return setCurrentQuery(value);
  };
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
    catalogQuery,
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

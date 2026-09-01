import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
} from "nuqs";

export const GALLERY_AGENT_KINDS = ["all", "cardano", "x402"] as const;

export type GalleryAgentKindFilter = (typeof GALLERY_AGENT_KINDS)[number];

export interface GalleryFilterState {
  query: string;
  categories: string[];
  kind: GalleryAgentKindFilter;
}

export default function useGalleryFilter() {
  // Catalog-only search. Coworker gallery keeps the separate `query` param so
  // the two tiers do not share / desync URL-backed search state.
  const [query, setQuery] = useQueryState("agentQuery", { defaultValue: "" });
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
    categories,
    kind,
    setQuery,
    setCategories,
    setKind,
    resetFilters,
  };
}

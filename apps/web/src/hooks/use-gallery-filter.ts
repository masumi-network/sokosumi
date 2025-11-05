import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs";

export interface GalleryFilterState {
  query: string;
  categories: string[];
}

export default function useGalleryFilter() {
  const [query, setQuery] = useQueryState("query", { defaultValue: "" });
  const [categories, setCategories] = useQueryState(
    "categories",
    parseAsArrayOf(parseAsString).withDefault([]),
  );

  const resetFilters = () => {
    setQuery("");
    setCategories([]);
  };

  return {
    query,
    categories,
    setQuery,
    setCategories,
    resetFilters,
  };
}

import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs";

export interface GalleryFilterState {
  query: string;
  tags: string[];
}

export default function useGalleryFilter() {
  const [query, setQuery] = useQueryState("query", { defaultValue: "" });
  const [tags, setTags] = useQueryState(
    "tags",
    parseAsArrayOf(parseAsString).withDefault([]),
  );

  const resetFilters = () => {
    setQuery("");
    setTags([]);
  };

  return {
    query,
    tags,
    setQuery,
    setTags,
    resetFilters,
  };
}

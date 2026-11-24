"use client";

import { useContext, useEffect } from "react";
import { PageListSearchContext } from "@/components/page-list-search";

/**
 * Seeds the enclosing page search field from a `?connect=` deep link when
 * `ToolConnectors` is writable and integrations are configured.
 */
export function useToolConnectorsLinkedQuerySeed(
  linkedQuery: string,
  readOnly: boolean,
  configured: boolean,
): void {
  const setPageQuery = useContext(PageListSearchContext)?.setQuery;

  useEffect(() => {
    if (linkedQuery && !readOnly && configured) setPageQuery?.(linkedQuery);
  }, [linkedQuery, readOnly, configured, setPageQuery]);
}

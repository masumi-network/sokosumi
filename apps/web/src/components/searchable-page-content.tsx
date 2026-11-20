"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChromePathname } from "@/app/chat/components/room-cache-provider";
import { PageListSearchContext } from "@/components/page-list-search";
import { PageSearchActions } from "@/components/page-search-actions";
import { PageSearchField } from "@/components/page-search-field";
import { Button } from "@/components/ui/button";
import { usePageTextFind } from "@/components/use-page-text-find";
import { cn } from "@/lib/utils";

/** Dashboards find visible text. Data-backed collections register to filter their records instead. */
export function SearchablePageContent({
  children,
  sidebar = false,
  heading,
  renderHeader,
}: {
  children: ReactNode;
  sidebar?: boolean;
  heading?: ReactNode;
  renderHeader?: (search: ReactNode) => ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [totals, setTotals] = useState({ lists: 0, hits: 0, partial: 0 });
  const register = useCallback((size: number, hasMore: boolean) => {
    function update(delta: number) {
      setTotals((current) => ({
        lists: current.lists + delta,
        hits: current.hits + delta * size,
        partial: current.partial + (hasMore ? delta : 0),
      }));
    }
    update(1);
    return () => update(-1);
  }, []);
  const context = useMemo(
    () => ({ query, setQuery, register }),
    [query, register],
  );
  const props = { content, query, setQuery, ...totals };
  return (
    <>
      {sidebar ? (
        <Suspense fallback={null}>
          <SidebarSearchToolbar {...props} />
        </Suspense>
      ) : (
        <SearchToolbar
          {...props}
          heading={heading}
          renderHeader={renderHeader}
        />
      )}
      <div ref={content} className="flex min-w-0 flex-1 flex-col">
        <PageListSearchContext.Provider value={context}>
          {children}
        </PageListSearchContext.Provider>
      </div>
    </>
  );
}

interface ToolbarProps {
  content: RefObject<HTMLDivElement | null>;
  query: string;
  setQuery: (value: string) => void;
  lists: number;
  hits: number;
  partial: number;
  focusOnMount?: boolean;
  heading?: ReactNode;
  renderHeader?: (search: ReactNode) => ReactNode;
}

const DASHBOARD_PATHS = [
  "/studio",
  "/tiktok-studio",
  "/competitors",
  "/chat",
  "/you",
  "/admin",
];
const SECTION_PATHS = [
  "/soko-bots",
  "/personal-assistant",
  "/account",
  "/organization",
  "/billing",
  "/developer",
  "/chat/catch-up",
];

/** List pages with their own data-backed field and chat rooms own their shortcuts. */
function SidebarSearchToolbar(props: ToolbarProps) {
  const pathname = useChromePathname();
  const params = useSearchParams();
  const agentProfile = /^\/agents\/[^/]+$/.test(pathname);
  const newsletterDashboard =
    pathname.startsWith("/newsletter/") &&
    pathname !== "/newsletter/issues" &&
    pathname !== "/newsletter/subscribers";
  const scoped =
    DASHBOARD_PATHS.includes(pathname) ||
    SECTION_PATHS.some(
      (section) => pathname === section || pathname.startsWith(section + "/"),
    ) ||
    /^\/projects\/[^/]+$/.test(pathname) ||
    agentProfile ||
    newsletterDashboard;
  const key = JSON.stringify([pathname, params?.get("projectId")]);
  if (!scoped) return null;
  return <SearchToolbar key={key} {...props} focusOnMount={agentProfile} />;
}

function SearchToolbar({
  content,
  query,
  setQuery,
  lists,
  hits,
  partial,
  focusOnMount,
  heading,
  renderHeader,
}: ToolbarProps) {
  const t = useTranslations("App.PageSearch");
  // The toolbar resets on navigation. Keep the route children mounted for the persistent chat shell.
  useEffect(() => () => setQuery(""), [setQuery]);
  const find = usePageTextFind(content, lists ? "" : query);
  const finding = !lists && Boolean(query.trim());
  const controls = (
    <>
      <PageSearchField
        inHeader={!focusOnMount}
        focusOnMount={focusOnMount}
        placeholder={t(lists ? "filter" : "find")}
        value={query}
        onValueChange={setQuery}
        onKeyDown={(event) => {
          if (finding && event.key === "Enter") {
            event.preventDefault();
            find.step(event.shiftKey ? -1 : 1);
          }
        }}
      />
      {lists > 0 && query.trim() && (
        <span role="status" className="text-muted-foreground text-sm">
          {t(partial ? "loadedResults" : "results", { count: hits })}
        </span>
      )}
      {finding && (
        <>
          <span
            role="status"
            className="text-muted-foreground text-sm tabular-nums"
          >
            {find.count
              ? t("position", { current: find.index + 1, total: find.count })
              : t("noMatches")}
          </span>
          <Button
            type="button"
            aria-label={t("previous")}
            disabled={!find.count}
            size="icon"
            variant="ghost"
            onClick={() => find.step(-1)}
          >
            <ChevronUp />
          </Button>
          <Button
            type="button"
            aria-label={t("next")}
            disabled={!find.count}
            size="icon"
            variant="ghost"
            onClick={() => find.step(1)}
          >
            <ChevronDown />
          </Button>
        </>
      )}
    </>
  );
  const sticky =
    finding &&
    "bg-background sticky top-[calc(5rem+env(safe-area-inset-top))] z-10 md:top-0";
  if (renderHeader)
    return <div className={cn(sticky)}>{renderHeader(controls)}</div>;
  return (
    <div
      className={cn(
        "@container/page-toolbar flex flex-wrap items-center gap-2 py-2",
        sticky,
      )}
    >
      {heading}
      {focusOnMount ? (
        controls
      ) : (
        <PageSearchActions>{controls}</PageSearchActions>
      )}
    </div>
  );
}

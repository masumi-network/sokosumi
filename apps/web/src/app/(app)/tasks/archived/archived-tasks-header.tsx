import { Search } from "lucide-react";
import Form from "next/form";
import type { useTranslations } from "next-intl";
import { BackToTasksButton } from "@/app/tasks/components/back-to-tasks-button";
import { Input } from "@/components/ui/input";

import { ARCHIVED_SEARCH_MAX_LENGTH } from "./archived-search";

/**
 * Back link, heading and search of Archived. The page and its loading shell
 * both draw it, so the list below starts at the same place in each.
 */
export function ArchivedTasksHeader({
  t,
  query,
  searchInert = false,
}: {
  t: ReturnType<typeof useTranslations<"App.Tasks.Archived">>;
  query?: string;
  /** The loading shell's search: what is typed there would be lost when the page lands. */
  searchInert?: boolean;
}) {
  return (
    <>
      <BackToTasksButton label={t("back")} />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <Form
        action="/tasks/archived"
        role="search"
        className="relative"
        inert={searchInert}
      >
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          name="q"
          defaultValue={query}
          maxLength={ARCHIVED_SEARCH_MAX_LENGTH}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="pl-9"
        />
      </Form>
    </>
  );
}

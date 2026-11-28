"use client";
import {
  Archive,
  ArrowLeft,
  Building2,
  Clock,
  Download,
  FileSpreadsheet,
  Globe,
  ListPlus,
  MoreHorizontal,
  Table2,
  UserPlus,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { PageSearchActions } from "@/components/page-search-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type ContactQuery,
  contactsService,
} from "@/lib/services/contacts.client";
import { ContactsPresetTabs } from "./contacts-views-bar";

type Layout = "map" | "companies" | null;

export function ContactsWorkspaceHeader({
  searchField,
  archived,
  view,
  layout,
  query,
  changeView,
  onLayout,
  onDialog,
}: {
  searchField?: React.ReactNode;
  archived: boolean;
  view: string;
  layout: Layout;
  query: ContactQuery;
  changeView: (next: string) => void;
  onLayout: (next: Layout) => void;
  onDialog: (kind: "add" | "import" | "linkedin" | "list") => void;
}) {
  const t = useTranslations("App.Contacts");
  const [exporting, setExporting] = useState(false);
  const viewSlot = useRef<HTMLDivElement>(null);
  const archiveHeading = useRef<HTMLHeadingElement>(null);
  const enteringArchive = useRef(false);
  const quiet = view === "quiet";
  const RoomIcon = quiet ? Clock : Archive;

  async function handleExport() {
    setExporting(true);
    try {
      const csv = await contactsService.exportCsv(query);
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(coreErrorOf(error).message ?? t("errors.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <header className="@container/page-toolbar flex min-w-0 flex-wrap items-center gap-2">
      <h1 className="sr-only">{t("title")}</h1>
      <div ref={viewSlot} className="min-w-0 flex-1">
        {layout === "companies" ? (
          <h2 className="flex h-10 items-center text-sm font-medium md:h-8">
            {t("views.companies")}
          </h2>
        ) : archived || quiet ? (
          // Archived and Gone quiet are side rooms, not tabs: name them while
          // open and lead straight back to the live contacts.
          <div className="flex min-w-0 items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("views.backToContacts")}
              className="size-10 shrink-0 md:size-8"
              onClick={() => {
                // The button unmounts; keep the keyboard on the view
                // control that replaces it.
                flushSync(() => changeView("all"));
                viewSlot.current
                  ?.querySelector<HTMLElement>('[aria-checked="true"]')
                  ?.focus();
              }}
            >
              <ArrowLeft aria-hidden className="size-4" />
            </Button>
            <h2
              ref={archiveHeading}
              tabIndex={-1}
              className="flex h-10 min-w-0 items-center gap-2 text-sm font-medium outline-none md:h-8"
            >
              <RoomIcon
                aria-hidden
                className="text-muted-foreground size-4 shrink-0"
              />
              <span className="truncate">
                {quiet ? t("quiet.title") : t("presets.archived")}
              </span>
            </h2>
          </div>
        ) : (
          <ContactsPresetTabs view={view} onViewChange={changeView} />
        )}
      </div>
      <PageSearchActions className={searchField ? undefined : "w-auto"}>
        {searchField}
        <div className="flex shrink-0 items-center gap-1">
          {archived || quiet ? null : (
            <ToggleGroup
              type="single"
              value={layout ?? "table"}
              onValueChange={(next) => {
                if (
                  next === "table" ||
                  next === "map" ||
                  next === "companies"
                ) {
                  onLayout(next === "table" ? null : next);
                }
              }}
              aria-label={t("layout.label")}
            >
              <ToggleGroupItem
                value="table"
                aria-label={t("layout.table")}
                className="size-10 px-0 md:size-8"
              >
                <Table2 aria-hidden className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="map"
                aria-label={t("layout.map")}
                className="size-10 px-0 md:size-8"
              >
                <Globe aria-hidden className="size-4" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="companies"
                aria-label={t("layout.companies")}
                className="size-10 px-0 md:size-8"
              >
                <Building2 aria-hidden className="size-4" />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <Button
            size="sm"
            variant="primary"
            className="h-10 md:h-8"
            onClick={() => onDialog("add")}
          >
            <UserPlus aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">{t("toolbar.add")}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={exporting}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("toolbar.more")}
                className="size-10 md:size-8"
                loading={exporting}
              >
                <MoreHorizontal aria-hidden className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                // Opening the archive lands on its heading, not the menu
                // button, so a screen reader announces the new view.
                if (!enteringArchive.current) return;
                enteringArchive.current = false;
                event.preventDefault();
                archiveHeading.current?.focus();
              }}
            >
              <DropdownMenuItem onClick={() => void handleExport()}>
                <Download aria-hidden className="size-4" />
                {t("toolbar.export")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDialog("import")}>
                <FileSpreadsheet aria-hidden className="size-4" />
                {t("views.import")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDialog("linkedin")}>
                <Users aria-hidden className="size-4" />
                {t("linkedInImport.menu")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDialog("list")}>
                <ListPlus aria-hidden className="size-4" />
                {t("views.newList")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  enteringArchive.current = true;
                  changeView("archived");
                }}
              >
                <Archive aria-hidden className="size-4" />
                {t("presets.archived")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageSearchActions>
    </header>
  );
}

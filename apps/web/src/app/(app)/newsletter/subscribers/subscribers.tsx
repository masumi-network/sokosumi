"use client";

import {
  type NewsletterSubscriber,
  type NewsletterSubscriberList,
  NewsletterSubscriberStatus,
  type PaginationMetadata,
} from "@sokosumi/core-client";
import { Plus, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";
import { useRef, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import { EmptyState } from "@/components/common/empty-state";
import { createAppColumnHelper } from "@/components/data-table/create-data-table-hook";
import DataTable from "@/components/data-table/data-table";
import { PageSearchActions } from "@/components/page-search-actions";
import { PageSearchField } from "@/components/page-search-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getEnvPublicConfig } from "@/config/env.public";
import { useEventListener } from "@/hooks/effects/use-event-listener";
import { useNewsletterSearchCancel } from "@/hooks/effects/use-newsletter-search-cancel";
import { cn } from "@/lib/utils";
import { AddFromContactsDialog } from "./add-from-contacts-dialog";
import { AddSubscriberDialog } from "./add-subscriber-dialog";
import { ImportSubscribersDialog } from "./import-subscribers-dialog";
import { subscriberSearchParams } from "./search-params";
import { SubscriberActions } from "./subscriber-actions";

const columnHelper = createAppColumnHelper<NewsletterSubscriber>();
const STATUSES = Object.values(NewsletterSubscriberStatus);

interface SubscribersProps {
  projectId: string;
  newsletterName: string;
  contactListId: string | null;
  data: NewsletterSubscriberList;
  pagination: PaginationMetadata;
  /** A CMO Project: CMO manages its subscribers, so they are only read. */
  readOnly?: boolean;
}

export function Subscribers({
  projectId,
  newsletterName,
  contactListId,
  data,
  pagination,
  readOnly = false,
}: SubscribersProps) {
  const t = useTranslations("App.Projects.Newsletter.Subscribers");
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<
    "search" | "status" | "clear" | "first" | "next" | null
  >(null);
  const [query, setQuery] = useQueryStates(subscriberSearchParams, {
    shallow: false,
    startTransition,
  });
  const debouncedSearch = useDebouncedCallback((search: string) => {
    setPendingAction("search");
    void setQuery({ search, cursor: null });
  }, getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME);
  const navKey = `${projectId}\0${query.search}\0${query.status ?? ""}\0${query.cursor ?? ""}`;
  const [prevNavKey, setPrevNavKey] = useState(navKey);
  const [searchValue, setSearchValue] = useState(query.search);
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey);
    setSearchValue(query.search);
  }
  useNewsletterSearchCancel({ navKey, debouncedSearch });
  useEventListener("window", "popstate", () => {
    debouncedSearch.cancel();
    setSearchValue(query.search);
  });
  const [dialog, setDialog] = useState<"add" | "import" | "contacts" | null>(
    null,
  );
  const addButton = useRef<HTMLButtonElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const contactsButton = useRef<HTMLButtonElement>(null);
  const total = Object.values(data.counts).reduce(
    (sum, count) => sum + count,
    0,
  );

  function renderName(subscriber: NewsletterSubscriber) {
    return subscriber.contact ? (
      <Link
        href={`/contacts?contact=${encodeURIComponent(subscriber.contact.id)}`}
        className="rounded-sm wrap-anywhere underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {subscriber.contact.name}
      </Link>
    ) : (
      <span className="wrap-anywhere">{subscriber.name ?? t("noName")}</span>
    );
  }

  const columns = columnHelper.columns([
    columnHelper.accessor("email", {
      header: t("columns.email"),
      size: 260,
      cell: ({ row }) => (
        <span className="break-all">{row.original.email}</span>
      ),
    }),
    columnHelper.accessor("name", {
      header: t("columns.name"),
      size: 180,
      cell: ({ row }) => renderName(row.original),
    }),
    columnHelper.accessor("status", {
      header: t("columns.status"),
      size: 150,
      cell: ({ row }) => (
        <Badge variant="secondary">
          {t(`statuses.${row.original.status}`)}
        </Badge>
      ),
    }),
    columnHelper.accessor("source", {
      header: t("columns.source"),
      size: 160,
      cell: ({ row }) => t(`sources.${row.original.source}`),
    }),
    columnHelper.accessor("createdAt", {
      header: t("columns.subscribedAt"),
      size: 170,
      cell: ({ row }) =>
        format.dateTime(new Date(row.original.createdAt), {
          dateStyle: "medium",
        }),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">{t("columns.actions")}</span>,
      size: 56,
      cell: ({ row }) =>
        readOnly ? null : (
          <div className="flex justify-end">
            <SubscriberActions
              key={row.original.id}
              projectId={projectId}
              subscriber={row.original}
            />
          </div>
        ),
    }),
  ]);

  const actions = readOnly ? null : (
    <div className="flex flex-wrap justify-center gap-2">
      <Button
        ref={contactsButton}
        variant="outline"
        onClick={() => setDialog("contacts")}
      >
        <Users />
        {t("fromContacts")}
      </Button>
      <Button
        ref={addButton}
        variant="primary"
        onClick={() => setDialog("add")}
      >
        <Plus />
        {t("add")}
      </Button>
      <Button
        ref={importButton}
        variant="outline"
        onClick={() => setDialog("import")}
      >
        <Upload />
        {t("import")}
      </Button>
    </div>
  );

  return (
    <section aria-label={t("title")} className="min-w-0 space-y-6">
      <div className="@container/page-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 sm:flex-1">
          <h3 className="text-base font-semibold">{t("title")}</h3>
          {contactListId ? (
            <Link
              href={`/contacts?list=${encodeURIComponent(contactListId)}`}
              className="text-muted-foreground rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t("openContactList")}
            </Link>
          ) : null}
        </div>
        <PageSearchActions>
          <PageSearchField
            id="subscriber-search"
            inHeader
            value={searchValue}
            aria-label={t("search")}
            placeholder={t("searchPlaceholder")}
            maxLength={254}
            onValueChange={(search) => {
              setSearchValue(search);
              if (!search) {
                debouncedSearch.cancel();
                setPendingAction("search");
                void setQuery({ search: "", cursor: null });
                return;
              }
              debouncedSearch(search);
            }}
          />
          {total > 0 ? actions : null}
        </PageSearchActions>
      </div>
      <dl className={cn(HOLDER_CLASS, "grid grid-cols-2 gap-2 lg:grid-cols-4")}>
        {STATUSES.map((status) => (
          <div
            key={status}
            className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-1 px-4 py-3")}
          >
            <dt className="text-muted-foreground text-sm wrap-anywhere">
              {t(`statuses.${status}`)}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {format.number(data.counts[status])}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="subscriber-status">{t("filterStatus")}</Label>
          <Select
            value={query.status ?? "all"}
            disabled={pending}
            onValueChange={(value) => {
              debouncedSearch.cancel();
              setSearchValue(query.search);
              setPendingAction("status");
              void setQuery({
                status: STATUSES.find((status) => status === value) ?? null,
                cursor: null,
              });
            }}
          >
            <SelectTrigger
              id="subscriber-status"
              className="min-w-44"
              aria-busy={pending && pendingAction === "status"}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`statuses.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {query.search.trim() || query.status ? (
          <Button
            variant="ghost"
            disabled={pending}
            loading={pending && pendingAction === "clear"}
            onClick={() => {
              debouncedSearch.cancel();
              setSearchValue("");
              setPendingAction("clear");
              void setQuery({ search: "", status: null, cursor: null });
            }}
          >
            {t("clearFilters")}
          </Button>
        ) : null}
      </div>
      {total === 0 ? (
        <div className={HOLDER_CLASS}>
          <EmptyState
            icon={Users}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            action={actions}
          />
        </div>
      ) : (
        <>
          <div aria-busy={pending} className={cn(HOLDER_CLASS, "min-w-0")}>
            <ul
              aria-label={t("title")}
              className="grid min-w-0 gap-2 lg:grid-cols-2 xl:hidden"
            >
              {data.subscribers.map((subscriber) => (
                <li
                  key={subscriber.id}
                  className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h4 className="text-sm font-semibold wrap-anywhere">
                        {subscriber.email}
                      </h4>
                      <div className="text-muted-foreground text-sm">
                        {renderName(subscriber)}
                      </div>
                    </div>
                    {readOnly ? null : (
                      <SubscriberActions
                        projectId={projectId}
                        subscriber={subscriber}
                      />
                    )}
                  </div>
                  <Badge
                    variant="secondary"
                    className="max-w-full whitespace-normal wrap-anywhere"
                  >
                    {t(`statuses.${subscriber.status}`)}
                  </Badge>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <dt className="text-muted-foreground wrap-anywhere">
                        {t("columns.source")}
                      </dt>
                      <dd className="wrap-anywhere">
                        {t(`sources.${subscriber.source}`)}
                      </dd>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <dt className="text-muted-foreground wrap-anywhere">
                        {t("columns.subscribedAt")}
                      </dt>
                      <dd className="wrap-anywhere">
                        {format.dateTime(new Date(subscriber.createdAt), {
                          dateStyle: "medium",
                        })}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
              {!data.subscribers.length ? (
                <li className={cn(HOLDER_ITEM_CLASS, "p-4 text-sm")}>
                  {t("results", { count: 0 })}
                </li>
              ) : null}
            </ul>
            <div className="hidden xl:block">
              <DataTable
                columns={columns}
                data={data.subscribers}
                enableRowSelection={false}
                showPagination={false}
                manualSorting
                tableClassName={HOLDER_ITEM_CLASS}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              role="status"
              className="text-muted-foreground text-sm tabular-nums"
            >
              {t("results", { count: pagination.total })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!pagination.cursor || pending}
                loading={pending && pendingAction === "first"}
                onClick={() => {
                  debouncedSearch.cancel();
                  setSearchValue(query.search);
                  setPendingAction("first");
                  void setQuery({ cursor: null });
                }}
              >
                {t("firstPage")}
              </Button>
              <Button
                variant="outline"
                disabled={!pagination.nextCursor || pending}
                loading={pending && pendingAction === "next"}
                onClick={() => {
                  debouncedSearch.cancel();
                  setSearchValue(query.search);
                  setPendingAction("next");
                  void setQuery({ cursor: pagination.nextCursor });
                }}
              >
                {t("nextPage")}
              </Button>
            </div>
          </div>
        </>
      )}
      {dialog === "add" ? (
        <AddSubscriberDialog
          projectId={projectId}
          newsletterName={newsletterName}
          onClose={() => setDialog(null)}
          onCloseAutoFocus={() => addButton.current?.focus()}
        />
      ) : null}
      {dialog === "import" ? (
        <ImportSubscribersDialog
          projectId={projectId}
          newsletterName={newsletterName}
          onClose={() => setDialog(null)}
          onCloseAutoFocus={() => importButton.current?.focus()}
        />
      ) : null}
      {dialog === "contacts" ? (
        <AddFromContactsDialog
          projectId={projectId}
          newsletterName={newsletterName}
          onClose={() => setDialog(null)}
          onCloseAutoFocus={() => contactsButton.current?.focus()}
        />
      ) : null}
    </section>
  );
}

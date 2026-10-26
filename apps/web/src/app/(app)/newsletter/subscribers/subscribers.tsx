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
import { type FormEvent, useRef, useState, useTransition } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { createAppColumnHelper } from "@/components/data-table/create-data-table-hook";
import DataTable from "@/components/data-table/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
}

export function Subscribers({
  projectId,
  newsletterName,
  contactListId,
  data,
  pagination,
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
      cell: ({ row }) =>
        row.original.contact ? (
          <Link
            href={`/contacts?contact=${encodeURIComponent(row.original.contact.id)}`}
            className="rounded-sm break-words underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {row.original.contact.name}
          </Link>
        ) : (
          <span className="break-words">
            {row.original.name ?? t("noName")}
          </span>
        ),
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
      cell: ({ row }) => (
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

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = String(
      new FormData(event.currentTarget).get("search") ?? "",
    ).trim();
    setPendingAction("search");
    void setQuery({ search, cursor: null });
  }

  const actions = (
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
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
        {total > 0 ? actions : null}
      </div>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATUSES.map((status) => (
          <div key={status} className="space-y-1">
            <dt className="text-muted-foreground text-sm">
              {t(`statuses.${status}`)}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {format.number(data.counts[status])}
            </dd>
          </div>
        ))}
      </dl>
      {total === 0 ? (
        <EmptyState
          icon={Users}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={actions}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <form
              onSubmit={handleSearch}
              className="flex min-w-0 flex-1 basis-full items-end gap-2 sm:basis-0"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="subscriber-search">{t("search")}</Label>
                <Input
                  key={query.search}
                  id="subscriber-search"
                  name="search"
                  type="search"
                  defaultValue={query.search}
                  maxLength={254}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("search")}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={pending}
                loading={pending && pendingAction === "search"}
              >
                {t("searchButton")}
              </Button>
            </form>
            <div className="space-y-2">
              <Label htmlFor="subscriber-status">{t("filterStatus")}</Label>
              <Select
                value={query.status ?? "all"}
                disabled={pending}
                onValueChange={(value) => {
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
            {query.search || query.status ? (
              <Button
                variant="ghost"
                disabled={pending}
                loading={pending && pendingAction === "clear"}
                onClick={() => {
                  setPendingAction("clear");
                  void setQuery({ search: "", status: null, cursor: null });
                }}
              >
                {t("clearFilters")}
              </Button>
            ) : null}
          </div>
          <div aria-busy={pending}>
            <DataTable
              columns={columns}
              data={data.subscribers}
              enableRowSelection={false}
              showPagination={false}
              manualSorting
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              role="status"
              className="text-muted-foreground text-sm tabular-nums"
            >
              {t("results", { count: pagination.total })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!pagination.cursor || pending}
                loading={pending && pendingAction === "first"}
                onClick={() => {
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

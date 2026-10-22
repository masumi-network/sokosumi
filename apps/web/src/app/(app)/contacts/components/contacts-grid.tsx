"use client";
import type { Contact, ContactList } from "@sokosumi/core-client";
import { ArrowDown, ArrowUp, PanelRightOpen } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CONTACT_STAGES,
  type ContactSort,
  channelLabel,
  isFollowUpDue,
  STAGE_DOT,
  sortChannels,
} from "@/app/contacts/contacts-view";
import { ColumnResizeHandle } from "@/components/data-grid/column-resize-handle";
import {
  GRID_ROW_BACKGROUND,
  GRID_ROW_CHROME,
  GRID_ROW_NUMBER,
  GRID_SCROLL_CONTAINER,
  GRID_STICKY_FIRST_COLUMN,
  GRID_STICKY_ROW_NUMBER,
} from "@/components/data-grid/grid-classes";
import {
  fitGridColumn,
  ROW_NUMBER_WIDTH,
} from "@/components/data-grid/grid-layout";
import { useGridFocus } from "@/components/data-grid/use-grid-focus";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { type CellEdit, ContactCell } from "./contact-cell";
import {
  AvatarStack,
  ChannelIcon,
  ContactAvatar,
  Dot,
  ListChip,
  PersonAvatar,
  StageChip,
} from "./contact-visuals";
import type { ContactFields } from "./use-contact-update";
import type { Teammate } from "./use-contacts-data";

type ColumnId =
  | "name"
  | "organization"
  | "role"
  | "stage"
  | "lists"
  | "channels"
  | "owner"
  | "lastContact"
  | "knownBy"
  | "followUp"
  | "updated";

const COLUMNS: { id: ColumnId; width: number; sort?: ContactSort }[] = [
  { id: "name", width: 240, sort: "name" },
  { id: "organization", width: 180, sort: "organization" },
  { id: "role", width: 170 },
  { id: "stage", width: 132, sort: "stage" },
  { id: "lists", width: 200 },
  { id: "channels", width: 150 },
  { id: "owner", width: 160 },
  { id: "lastContact", width: 136, sort: "lastContactAt" },
  { id: "knownBy", width: 120 },
  { id: "followUp", width: 132 },
  { id: "updated", width: 132, sort: "updatedAt" },
];

/** A click on the name opens the person but leaves focus on the cell. */
function keepCellFocus(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.currentTarget.closest<HTMLElement>('[role="gridcell"]')?.focus();
}

const WIDTHS_KEY = "contacts-grid-widths";

/** Column widths are a per-viewer convenience, kept in this browser only. */
function useColumnWidths() {
  const [widths, setWidths] = useState<Partial<Record<ColumnId, number>>>(
    () => {
      try {
        return JSON.parse(window.localStorage.getItem(WIDTHS_KEY) ?? "{}");
      } catch {
        return {};
      }
    },
  );
  function save(id: ColumnId, width: number, persist: boolean) {
    setWidths((previous) => {
      const next = { ...previous, [id]: width };
      if (persist)
        try {
          window.localStorage.setItem(WIDTHS_KEY, JSON.stringify(next));
        } catch {}
      return next;
    });
  }
  return { widths, save };
}

interface Props {
  contacts: Contact[];
  lists: ContactList[];
  teammates: Teammate[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  sort: ContactSort;
  direction: "asc" | "desc";
  onSort: (sort: ContactSort) => void;
  onOpen: (id: string) => void;
  onUpdate: (
    contact: Contact,
    fields: ContactFields,
    optimistic?: Partial<Contact>,
  ) => Promise<boolean>;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  footer: ReactNode;
}

export function ContactsGrid({
  contacts,
  teammates,
  selected,
  onSelectedChange,
  sort,
  direction,
  onSort,
  onOpen,
  onUpdate,
  hasMore,
  loadingMore,
  onLoadMore,
  footer,
}: Props) {
  const t = useTranslations("App.Contacts");
  const format = useFormatter();
  const grid = useRef<HTMLTableElement>(null);
  const sentinel = useRef<HTMLTableRowElement>(null);
  const { widths, save } = useColumnWidths();
  const columns = COLUMNS.map((column) => ({
    ...column,
    width: widths[column.id] ?? column.width,
  }));
  const { gridId, cellProps } = useGridFocus(
    contacts.map((contact) => contact.id),
    columns.map((column) => column.id),
  );
  const gridWidth = columns.reduce(
    (total, column) => total + column.width,
    ROW_NUMBER_WIDTH,
  );
  const today = new Date();

  // Infinite scroll: the sentinel under the last row asks for the next page.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  function relative(date: Date | string | null) {
    if (!date) return "";
    const value = new Date(date);
    return format.relativeTime(value, today);
  }
  function day(date: string | null) {
    if (!date) return "";
    return format.dateTime(new Date(`${date}T00:00:00Z`), {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }

  const ownerChoices = [
    { value: "", label: t("grid.noOwner") },
    ...teammates.map((person) => ({
      value: person.id,
      label: person.name,
      icon: <PersonAvatar person={person} />,
    })),
  ];
  const stageChoices = CONTACT_STAGES.map((stage) => ({
    value: stage,
    label: t(`stages.${stage}`),
    icon: <Dot className={STAGE_DOT[stage]} />,
  }));

  function textEdit(
    contact: Contact,
    field: "name" | "organization" | "role",
  ): CellEdit {
    return {
      kind: "text",
      value: contact[field] ?? "",
      onSave: (value) => {
        const trimmed = value.trim();
        if (field === "name" && !trimmed) return Promise.resolve(false);
        return onUpdate(contact, { [field]: trimmed || null });
      },
    };
  }

  function cell(
    contact: Contact,
    column: ColumnId,
  ): {
    text: string;
    node: ReactNode;
    edit?: CellEdit;
    onOpen?: () => void;
  } {
    switch (column) {
      case "name":
        return {
          text: contact.name,
          edit: textEdit(contact, "name"),
          onOpen: () => onOpen(contact.id),
          node: (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <ContactAvatar name={contact.name} src={contact.avatarUrl} />
              <button
                type="button"
                tabIndex={-1}
                data-fit
                onMouseDown={keepCellFocus}
                onClick={() => onOpen(contact.id)}
                className="hover:decoration-foreground min-w-0 cursor-pointer truncate text-start font-medium underline decoration-transparent underline-offset-4 transition-colors"
              >
                {contact.name}
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("grid.openContact", { name: contact.name })}
                onMouseDown={keepCellFocus}
                onClick={() => onOpen(contact.id)}
                className="text-muted-foreground hover:text-foreground ms-auto hidden shrink-0 cursor-pointer group-hover/row:inline-flex group-aria-selected/cell:inline-flex"
              >
                <PanelRightOpen aria-hidden className="size-4" />
              </button>
            </span>
          ),
        };
      case "organization":
      case "role":
        return {
          text: contact[column] ?? "",
          edit: textEdit(contact, column),
          node: (
            <span
              data-fit
              className={cn(
                "truncate",
                column === "role" && "text-muted-foreground",
              )}
            >
              {contact[column]}
            </span>
          ),
        };
      case "stage":
        return {
          text: t(`stages.${contact.stage}`),
          edit: {
            kind: "choice",
            value: contact.stage,
            choices: stageChoices,
            onSave: (value) =>
              onUpdate(contact, { stage: value as Contact["stage"] }),
          },
          node: <StageChip stage={contact.stage} />,
        };
      case "lists":
        return {
          text: contact.lists.map((list) => list.name).join(", "),
          node: (
            <span data-fit className="flex min-w-0 gap-1 overflow-hidden">
              {contact.lists.map((list) => (
                <ListChip key={list.id} name={list.name} color={list.color} />
              ))}
            </span>
          ),
        };
      case "channels": {
        const channels = sortChannels(contact.channels);
        const types = [...new Set(channels.map((channel) => channel.type))];
        return {
          text: channels.map(channelLabel).join(", "),
          node: (
            <span
              data-fit
              role="img"
              aria-label={types
                .map((type) => t(`channelTypes.${type}`))
                .join(", ")}
              className="text-muted-foreground flex items-center gap-2"
            >
              {types.map((type) => (
                <ChannelIcon key={type} type={type} />
              ))}
            </span>
          ),
        };
      }
      case "owner":
        return {
          text: contact.owner?.name ?? "",
          edit: {
            kind: "choice",
            value: contact.owner?.id ?? "",
            choices: ownerChoices,
            onSave: (value) => {
              const person = teammates.find((item) => item.id === value);
              return onUpdate(
                contact,
                { ownerUserId: value || null },
                { owner: person ?? null },
              );
            },
          },
          node: contact.owner ? (
            <span data-fit className="flex min-w-0 items-center gap-2">
              <PersonAvatar person={contact.owner} />
              <span className="truncate">{contact.owner.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        };
      case "lastContact":
        return {
          text: relative(contact.lastContactAt),
          node: (
            <span
              data-fit
              className="text-muted-foreground truncate tabular-nums"
            >
              {relative(contact.lastContactAt) || "—"}
            </span>
          ),
        };
      case "knownBy":
        return {
          text: contact.knownBy.map((person) => person.name).join(", "),
          node: contact.knownBy.length ? (
            <AvatarStack
              people={contact.knownBy}
              label={t("grid.knownByLabel", {
                names: contact.knownBy.map((person) => person.name).join(", "),
              })}
            />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        };
      case "followUp": {
        const due = isFollowUpDue(contact.followUpAt, today);
        return {
          text: day(contact.followUpAt),
          edit: {
            kind: "date",
            value: contact.followUpAt ?? "",
            onSave: (value) => onUpdate(contact, { followUpAt: value || null }),
          },
          node: contact.followUpAt ? (
            <span
              data-fit
              className={cn(
                "flex items-center gap-1.5 tabular-nums",
                due ? "text-semantic-destructive-label" : "text-foreground",
              )}
            >
              {due ? <Dot className="bg-semantic-destructive" /> : null}
              {day(contact.followUpAt)}
              {due ? <span className="sr-only">{t("grid.due")}</span> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        };
      }
      case "updated":
        return {
          text: relative(contact.updatedAt),
          node: (
            <span
              data-fit
              className="text-muted-foreground truncate tabular-nums"
            >
              {relative(contact.updatedAt)}
            </span>
          ),
        };
    }
  }

  const allSelected =
    contacts.length > 0 && selected.length === contacts.length;

  return (
    <div
      className="min-w-0"
      style={
        {
          "--sheet-sticky": `${ROW_NUMBER_WIDTH + columns[0].width}px`,
        } as CSSProperties
      }
    >
      <Table
        ref={grid}
        role="grid"
        aria-label={t("grid.label")}
        aria-describedby={`${gridId}-keys`}
        aria-rowcount={contacts.length}
        className="table-fixed border-separate border-spacing-0"
        style={{ width: gridWidth }}
        containerClassName={cn(
          "max-h-[calc(100dvh-15rem)]",
          GRID_SCROLL_CONTAINER,
        )}
      >
        <colgroup>
          <col style={{ width: ROW_NUMBER_WIDTH }} />
          {columns.map((column) => (
            <col key={column.id} style={{ width: column.width }} />
          ))}
        </colgroup>
        <TableHeader className="bg-card-background sticky top-0 z-20">
          <TableRow className="hover:bg-transparent">
            <TableHead className="bg-card-background sticky start-0 z-10 border-e border-b px-0">
              <div className="flex items-center justify-center">
                <Checkbox
                  aria-label={t("grid.selectAll")}
                  checked={
                    allSelected
                      ? true
                      : selected.length
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={(checked) =>
                    onSelectedChange(
                      checked ? contacts.map((contact) => contact.id) : [],
                    )
                  }
                />
              </div>
            </TableHead>
            {columns.map((column, columnIndex) => {
              const label = t(`columns.${column.id}`);
              const sorted = column.sort && column.sort === sort;
              return (
                <TableHead
                  key={column.id}
                  scope="col"
                  data-column={column.id}
                  aria-sort={
                    sorted
                      ? direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={cn(
                    "bg-card-background relative h-10 border-e border-b px-3",
                    columnIndex === 0 && GRID_STICKY_FIRST_COLUMN,
                  )}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      onClick={() => column.sort && onSort(column.sort)}
                      className={cn(
                        "hover:text-foreground focus-visible:ring-ring flex max-w-full items-center gap-1 rounded-sm text-xs font-medium outline-none focus-visible:ring-2",
                        sorted ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <span data-fit className="truncate">
                        {label}
                      </span>
                      {sorted ? (
                        direction === "asc" ? (
                          <ArrowUp aria-hidden className="size-3.5 shrink-0" />
                        ) : (
                          <ArrowDown
                            aria-hidden
                            className="size-3.5 shrink-0"
                          />
                        )
                      ) : null}
                    </button>
                  ) : (
                    <span
                      data-fit
                      className="text-muted-foreground block truncate text-xs font-medium"
                    >
                      {label}
                    </span>
                  )}
                  <ColumnResizeHandle
                    label={t("grid.resizeColumn", { column: label })}
                    width={column.width}
                    onPreview={(width) => save(column.id, width, false)}
                    onResize={(width) => save(column.id, width, true)}
                    onFit={() => {
                      const width = fitGridColumn(grid.current, column.id);
                      if (width !== null) save(column.id, width, true);
                    }}
                  />
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact, rowIndex) => {
            const isSelected = selected.includes(contact.id);
            return (
              <TableRow
                key={contact.id}
                className="group/row hover:bg-card-background-hover"
                data-state={isSelected ? "selected" : undefined}
              >
                <th
                  scope="row"
                  className={cn(
                    GRID_ROW_BACKGROUND,
                    GRID_STICKY_ROW_NUMBER,
                    "border-e border-b p-0 font-normal",
                  )}
                >
                  <div className="relative h-10">
                    <span
                      className={cn(
                        "text-muted-foreground absolute inset-0 flex items-center justify-center text-xs tabular-nums",
                        selected.length ? "opacity-0" : GRID_ROW_NUMBER,
                      )}
                    >
                      {rowIndex + 1}
                    </span>
                    <div
                      className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        !selected.length && GRID_ROW_CHROME,
                      )}
                    >
                      <Checkbox
                        aria-label={t("grid.selectRow", {
                          name: contact.name,
                        })}
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          onSelectedChange(
                            checked
                              ? [...selected, contact.id]
                              : selected.filter((id) => id !== contact.id),
                          )
                        }
                      />
                    </div>
                  </div>
                </th>
                {columns.map((column, columnIndex) => {
                  const content = cell(contact, column.id);
                  return (
                    <ContactCell
                      key={column.id}
                      {...cellProps(rowIndex, columnIndex)}
                      className={
                        columnIndex === 0
                          ? cn(GRID_ROW_BACKGROUND, GRID_STICKY_FIRST_COLUMN)
                          : undefined
                      }
                      columnId={column.id}
                      label={t(`columns.${column.id}`)}
                      text={content.text}
                      edit={content.edit}
                      onOpen={content.onOpen}
                    >
                      {content.node}
                    </ContactCell>
                  );
                })}
              </TableRow>
            );
          })}
          {hasMore ? (
            <tr ref={sentinel} aria-hidden>
              <td colSpan={columns.length + 1} className="h-px p-0" />
            </tr>
          ) : null}
        </TableBody>
      </Table>
      <p id={`${gridId}-keys`} hidden>
        {t("grid.keys")}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
        <p role="status" className="text-muted-foreground text-xs">
          {footer}
        </p>
        {hasMore ? (
          <Button
            size="sm"
            variant="outline"
            loading={loadingMore}
            onClick={onLoadMore}
          >
            {t("grid.loadMore")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

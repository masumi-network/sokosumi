"use client";

import type {
  Contact,
  FileResource,
  HistoryItem,
  TaskListItem,
  WorkspaceLabel,
} from "@sokosumi/core-client";
import { Copy, FileText, ListTodo, SquarePen } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  HistorySearchItemIcon,
  HistorySearchItemOwner,
  HistorySearchItemTime,
} from "@/app/components/history-search-item";
import { getHistorySearchItemHref } from "@/app/components/history-search-item-href";
import { HistorySearchItemStatus } from "@/app/components/history-search-item-status";
import { useOptionalNewTaskWizard } from "@/app/components/new-task-wizard-provider";
import { useContactSearchGroup } from "@/app/components/use-contact-search-group";
import { useFileSearchGroup } from "@/app/components/use-file-search-group";
import { useHistorySearchCorpus } from "@/app/components/use-history-search-corpus";
import { useTagSearchGroup } from "@/app/components/use-tag-search-group";
import { ContactAvatar } from "@/app/contacts/components/contact-visuals";
import { primaryEmail } from "@/app/contacts/contacts-view";
import { TaskStatusBadge } from "@/app/tasks/components/task-status-badge";
import { TaskTagDot } from "@/app/tasks/components/task-tag-colors";
import { taskHref } from "@/app/tasks/utils/task-href";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { copyTextWithToast } from "@/hooks/effects/use-clipboard";
import {
  matchesMediaQuery,
  subscribeMediaQuery,
} from "@/hooks/effects/use-media-query";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { escapeMarkdownDisplayText } from "@/lib/utils/mention-parser";

interface HistorySearchDialogLabels {
  dialogTitle: string;
  dialogDescription: string;
  searchPlaceholder: string;
  empty: string;
  loading: string;
  error: string;
  created: string;
  filesGroup: string;
  filesSeeAll: string;
  filesFilenameMatch: string;
  peopleGroup: string;
  copyEmail: (email: string) => string;
  emailCopied: string;
  emailCopyFailed: string;
  mentionInTask: (name: string) => string;
  tagsGroup: string;
  tagTasksGroup: (tag: string) => string;
  tagsError: string;
  tagTasksError: string;
}

interface HistorySearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  labels: HistorySearchDialogLabels;
  activeOrganizationId: string | null;
}

export function HistorySearchDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  labels,
  activeOrganizationId,
}: HistorySearchDialogProps) {
  const router = useRouter();
  const { formatDateWithYear } = useLocalizedDateTime();
  const showOwner = activeOrganizationId !== null;
  const { query, debouncedQuery, setQuery, history, error, isLoading, reset } =
    useHistorySearchCorpus({
      open,
      activeOrganizationId,
      errorLabel: labels.error,
    });
  // The Files group shares the dialog's debounced query. A failure here
  // hides the group; it never takes the other sections down with it.
  const { files } = useFileSearchGroup({
    open,
    activeOrganizationId,
    debouncedQuery: query,
  });
  const { contacts, isLoading: contactsLoading } = useContactSearchGroup({
    open,
    activeOrganizationId,
    debouncedQuery,
  });
  // Until the debounce settles, People still shows the previous query's
  // contacts: they open, but their quick actions wait.
  const contactsStale = query.trim() !== debouncedQuery.trim();
  const wizard = useOptionalNewTaskWizard();
  const { tags, tagsState, topTag, tasks, tasksState } = useTagSearchGroup({
    open,
    activeOrganizationId,
    debouncedQuery: query,
  });
  // Tags or People still loading, or Tags failed, never read as "No
  // results found".
  const searching = [isLoading, contactsLoading, tagsState === "loading"].some(
    Boolean,
  );
  const nothingFound =
    !searching &&
    tagsState !== "error" &&
    [history, tags, files, contacts].every((group) => group.length === 0);

  const { listRef, listMaxHeight } = useListFitsVisibleViewport(open);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      reset();
    }

    onOpenChange(nextOpen);
  }

  // A result opens another page: focus belongs there, not back on the
  // Search button (its tooltip would open over the new page).
  const navigatingRef = useRef(false);

  function handleCloseAutoFocus(event: Event) {
    if (navigatingRef.current) {
      navigatingRef.current = false;
      event.preventDefault();
      return;
    }
    onCloseAutoFocus?.(event);
  }

  function closeAndGo(href: string) {
    navigatingRef.current = true;
    // Use the same close path as the dialog itself so we reset state
    // and ignore any in-flight history requests.
    handleOpenChange(false);
    router.push(href);
  }

  function handleSelectFile(file: FileResource) {
    closeAndGo(`/drive/files/${file.id}`);
  }

  function handleSeeAllFiles() {
    closeAndGo(
      `/drive?view=workspace${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`,
    );
  }

  function handleSelectContact(contact: Contact) {
    closeAndGo(`/contacts?contact=${encodeURIComponent(contact.id)}`);
  }

  function handleCopyEmail(email: string) {
    void copyTextWithToast(email, {
      copySuccessMessage: labels.emailCopied,
      copyErrorMessage: labels.emailCopyFailed,
    });
  }

  function handleMentionInTask(contact: Contact) {
    if (!wizard) return;
    // Absolute, since a Coworker reading the Task is not inside the app.
    const href = new URL(
      `/contacts?contact=${encodeURIComponent(contact.id)}`,
      window.location.origin,
    );
    // Focus belongs to the new Task draft, not the Search button.
    navigatingRef.current = true;
    handleOpenChange(false);
    wizard.openNewTaskWizard({
      prompt: `[${escapeMarkdownDisplayText(contact.name)}](${href}) `,
    });
  }

  function handleSelectTag(tag: WorkspaceLabel) {
    closeAndGo(`/tasks?tag=${encodeURIComponent(tag.id)}`);
  }

  function handleSelectTask(task: TaskListItem) {
    closeAndGo(taskHref(task));
  }

  function handleSelect(item: HistoryItem) {
    closeAndGo(getHistorySearchItemHref(item));
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={labels.dialogTitle}
      description={labels.dialogDescription}
      commandProps={{ shouldFilter: false }}
      contentProps={{
        // Phones: pin under the safe area, not centered, so the on-screen
        // keyboard does not cover the results.
        className:
          "max-sm:top-[calc(env(safe-area-inset-top)+1rem)] max-sm:translate-y-0",
      }}
      onCloseAutoFocus={handleCloseAutoFocus}
    >
      <CommandInput
        placeholder={labels.searchPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList ref={listRef} style={{ maxHeight: listMaxHeight }}>
        {searching && history.length === 0 ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {labels.loading}
          </div>
        ) : null}

        {nothingFound && error ? (
          <div className="text-muted-foreground px-2 py-6 text-center text-sm">
            {error}
          </div>
        ) : null}

        {nothingFound && !error ? (
          <CommandEmpty>{labels.empty}</CommandEmpty>
        ) : null}

        <TagSearchGroups
          tags={tags}
          tagsState={tagsState}
          topTag={topTag}
          tasks={tasks}
          tasksState={tasksState}
          labels={labels}
          showOwner={showOwner}
          formatShortDate={formatDateWithYear}
          onSelectTag={handleSelectTag}
          onSelectTask={handleSelectTask}
        />

        <PeopleSearchGroup
          contacts={contacts}
          labels={labels}
          actionsDisabled={contactsStale}
          onSelect={handleSelectContact}
          onCopyEmail={handleCopyEmail}
          onMentionInTask={wizard ? handleMentionInTask : undefined}
        />

        {history.length > 0 ? (
          <CommandGroup heading={labels.dialogTitle}>
            {history.map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.title} ${item.id}`}
                onSelect={() => handleSelect(item)}
                className="flex items-start gap-2"
              >
                <SearchResultRow
                  icon={
                    <HistorySearchItemIcon
                      item={item}
                      className="mt-0.5 size-4"
                    />
                  }
                  title={item.title}
                  createdAt={item.createdAt}
                  owner={showOwner ? item.owner : null}
                  status={<HistorySearchItemStatus item={item} />}
                  formatShortDate={formatDateWithYear}
                  createdLabel={labels.created}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {files.length > 0 ? (
          <CommandGroup heading={labels.filesGroup}>
            {files.map((file) => (
              <CommandItem
                key={file.id}
                value={`file:${file.id}`}
                onSelect={() => handleSelectFile(file)}
                className="flex items-start gap-2"
              >
                <FileText className="mt-0.5 size-4" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate">{file.displayName}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {file.filenameMatch
                      ? labels.filesFilenameMatch
                      : (file.snippet?.text ?? file.mimeType ?? "")}
                  </span>
                </div>
              </CommandItem>
            ))}
            <CommandItem
              value="file:see-all"
              onSelect={handleSeeAllFiles}
              className="text-muted-foreground text-xs"
            >
              {labels.filesSeeAll}
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

interface TagSearchGroupsProps {
  tags: WorkspaceLabel[];
  topTag: WorkspaceLabel | undefined;
  tasks: TaskListItem[];
  tagsState: "loading" | "error" | "ready" | null;
  tasksState: "loading" | "error" | "ready";
  labels: Pick<
    HistorySearchDialogLabels,
    | "tagsGroup"
    | "tagTasksGroup"
    | "tagsError"
    | "tagTasksError"
    | "loading"
    | "created"
  >;
  showOwner: boolean;
  formatShortDate: (date: string | Date) => string;
  onSelectTag: (tag: WorkspaceLabel) => void;
  onSelectTask: (task: TaskListItem) => void;
}

function TagSearchGroups({
  tags,
  topTag,
  tasks,
  tagsState,
  tasksState,
  labels,
  showOwner,
  formatShortDate,
  onSelectTag,
  onSelectTask,
}: TagSearchGroupsProps) {
  return (
    <>
      {tagsState === "error" ? (
        <SearchNote>{labels.tagsError}</SearchNote>
      ) : null}

      {tags.length > 0 ? (
        <CommandGroup heading={labels.tagsGroup}>
          {tags.map((tag) => (
            <CommandItem
              key={tag.id}
              value={`tag:${tag.id}`}
              onSelect={() => onSelectTag(tag)}
              className="flex items-center gap-2"
            >
              <TaskTagDot
                id={tag.id}
                color={tag.color}
                customColor={tag.customColor}
                taskTopicId={tag.taskTopicId}
              />
              <span className="min-w-0 flex-1 truncate">
                #{tag.displayName}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}

      {topTag && (tasks.length > 0 || tasksState !== "ready") ? (
        <CommandGroup heading={labels.tagTasksGroup(topTag.displayName)}>
          {tasksState === "loading" ? (
            <SearchNote>{labels.loading}</SearchNote>
          ) : null}
          {tasksState === "error" ? (
            <SearchNote>{labels.tagTasksError}</SearchNote>
          ) : null}
          {tasks.map((task) => (
            <CommandItem
              key={task.id}
              value={`tag-task:${task.id}`}
              onSelect={() => onSelectTask(task)}
              className="flex items-start gap-2"
            >
              <SearchResultRow
                icon={<ListTodo className="mt-0.5 size-4" aria-hidden />}
                title={task.name}
                createdAt={task.createdAt}
                owner={
                  showOwner && task.owner
                    ? {
                        userId: task.owner.id,
                        name: task.owner.name,
                        image: task.owner.image ?? null,
                      }
                    : null
                }
                status={
                  <TaskStatusBadge
                    status={task.status}
                    className="ml-auto shrink-0"
                  />
                }
                formatShortDate={formatShortDate}
                createdLabel={labels.created}
              />
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}

/**
 * Contacts matching the query; picking one opens its panel in Contacts.
 * Copy email and Mention in a new Task sit beside each row as their own
 * options, so arrow keys reach them and nothing interactive nests.
 */
function PeopleSearchGroup({
  contacts,
  labels,
  actionsDisabled,
  onSelect,
  onCopyEmail,
  onMentionInTask,
}: {
  contacts: Contact[];
  labels: Pick<
    HistorySearchDialogLabels,
    "peopleGroup" | "copyEmail" | "mentionInTask"
  >;
  actionsDisabled: boolean;
  onSelect: (contact: Contact) => void;
  onCopyEmail: (email: string) => void;
  onMentionInTask?: (contact: Contact) => void;
}) {
  if (contacts.length === 0) return null;
  const actionClassName = "size-10 shrink-0 justify-center px-0 md:size-8";
  return (
    <CommandGroup heading={labels.peopleGroup}>
      {contacts.map((contact) => {
        const email = primaryEmail(contact.channels);
        return (
          <div key={contact.id} className="flex items-center gap-1">
            <CommandItem
              value={`contact:${contact.id}`}
              onSelect={() => onSelect(contact)}
              className="min-w-0 flex-1"
            >
              <PersonRow contact={contact} email={email} />
            </CommandItem>
            {email ? (
              <CommandItem
                value={`contact-email:${contact.id}`}
                aria-label={labels.copyEmail(email)}
                title={labels.copyEmail(email)}
                disabled={actionsDisabled}
                onSelect={() => onCopyEmail(email)}
                className={actionClassName}
              >
                <Copy aria-hidden />
              </CommandItem>
            ) : null}
            {onMentionInTask ? (
              <CommandItem
                value={`contact-task:${contact.id}`}
                aria-label={labels.mentionInTask(contact.name)}
                title={labels.mentionInTask(contact.name)}
                disabled={actionsDisabled}
                onSelect={() => onMentionInTask(contact)}
                className={actionClassName}
              >
                <SquarePen aria-hidden />
              </CommandItem>
            ) : null}
          </div>
        );
      })}
    </CommandGroup>
  );
}

/** Avatar, name, then role and company. */
function PersonRow({
  contact,
  email,
}: {
  contact: Contact;
  email: string | null;
}) {
  return (
    <>
      <ContactAvatar
        name={contact.name}
        src={contact.avatarUrl}
        email={email}
        kind={contact.kind}
        className="size-5"
      />
      <div className="min-w-0 flex-1">
        <span className="block truncate">{contact.name}</span>
        {contact.organization || contact.role ? (
          <span className="text-muted-foreground block truncate text-xs">
            {[contact.role, contact.organization].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>
    </>
  );
}

/** One result's body: icon, title over its date, then owner and status. */
function SearchResultRow({
  icon,
  title,
  createdAt,
  owner,
  status,
  formatShortDate,
  createdLabel,
}: {
  icon: ReactNode;
  title: string;
  createdAt: string | Date;
  owner: HistoryItem["owner"];
  status: ReactNode;
  formatShortDate: (date: string | Date) => string;
  createdLabel: string;
}) {
  return (
    <>
      {icon}
      <div className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <HistorySearchItemTime
          createdAt={createdAt}
          formatShortDate={formatShortDate}
          createdLabel={createdLabel}
          className="text-muted-foreground mt-0.5 block text-left text-xs sm:text-left"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 self-center">
        {owner ? (
          <HistorySearchItemOwner
            owner={owner}
            className="hidden sm:inline-flex"
          />
        ) : null}
        {status}
      </div>
    </>
  );
}

/** A non-selectable status line in the results, read out when it changes. */
function SearchNote({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="text-muted-foreground px-2 py-3 text-center text-sm"
    >
      {children}
    </div>
  );
}

/** `CommandList`'s usual `max-h-[300px]`. */
const LIST_MAX_HEIGHT_PX = 300;
const LIST_KEYBOARD_GAP_PX = 8;
/** Tailwind `max-sm`, where the dialog is pinned to the top. */
const PHONE_LAYOUT_QUERY = "(width < 40rem)";

function getServerListMaxHeight(): undefined {
  return undefined;
}

/**
 * Phone layout only: caps the results list at the bottom of the visual
 * viewport, which the on-screen keyboard shrinks, so every row stays
 * reachable by scrolling. No floor: a floor would push the list's end back
 * under the keyboard. The centered tablet and desktop dialog keeps its
 * 300px cap, since its list top moves with result count.
 */
function useListFitsVisibleViewport(open: boolean) {
  // State, not a ref: the dialog portal mounts the list after the first effect.
  const [list, listRef] = useState<HTMLDivElement | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const viewport = window.visualViewport;
      if (!open || !viewport || !list) return () => {};

      viewport.addEventListener("resize", onStoreChange);
      viewport.addEventListener("scroll", onStoreChange);
      const unsubscribeMedia = subscribeMediaQuery(
        PHONE_LAYOUT_QUERY,
        onStoreChange,
      );
      return () => {
        viewport.removeEventListener("resize", onStoreChange);
        viewport.removeEventListener("scroll", onStoreChange);
        unsubscribeMedia();
      };
    },
    [open, list],
  );

  const getSnapshot = useCallback((): number | undefined => {
    const viewport = window.visualViewport;
    if (!open || !viewport || !list || !matchesMediaQuery(PHONE_LAYOUT_QUERY)) {
      return undefined;
    }
    const visibleBottom = viewport.offsetTop + viewport.height;
    const room =
      visibleBottom - list.getBoundingClientRect().top - LIST_KEYBOARD_GAP_PX;
    return Math.min(LIST_MAX_HEIGHT_PX, Math.max(0, room));
  }, [open, list]);

  const listMaxHeight = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerListMaxHeight,
  );

  return { listRef, listMaxHeight };
}

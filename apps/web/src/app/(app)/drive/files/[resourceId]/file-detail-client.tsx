"use client";

import { ArrowLeft, Check, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DriveFilePreview } from "@/app/drive/components/drive-file-preview";
import { DriveFileSnippet } from "@/app/drive/components/drive-file-snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { FileTypeIcon } from "@/components/ui/file-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSession } from "@/lib/auth/auth.client";
import type {
  FileResource,
  WorkspaceLabel,
} from "@/lib/clients/generated/core";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  decideSuggestion,
  type FileStore,
  fetchFileResource,
  fetchRelatedFiles,
  fetchWorkspaceLabels,
  updateFileMetadata,
} from "@/lib/utils/file-search.client";

/**
 * One document: what it is, what it is about, and what else is like it.
 *
 * A suggestion is shown as a suggestion — outlined, labelled, with the
 * extracted span that justifies it — and confirming one says in words that
 * nobody gains access. Both are the point of the screen, not decoration.
 */

/** Last dotted segment, lowercased. Empty for a name with no extension. */
function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

export function FileDetailClient({ resourceId }: { resourceId: string }) {
  const t = useTranslations("App.Drive.Files");
  const { data: session, isPending: sessionPending } = useSession();
  const activeOrganizationId = session?.session?.activeOrganizationId ?? null;
  const driveStore = driveStoreForActiveWorkspace(activeOrganizationId);
  const store: FileStore =
    driveStore.scope === "org"
      ? { scope: "org", organizationId: driveStore.organizationId }
      : { scope: "me" };

  const [resource, setResource] = useState<FileResource | null>(null);
  const [related, setRelated] = useState<FileResource[]>([]);
  const [relatedState, setRelatedState] = useState<string>("ok");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * The tag vocabulary for the picker, fetched the first time it opens.
   *
   * `null` is "not fetched yet", which is also what it goes back to when a
   * fetch fails so that reopening retries. An empty array is a real
   * answer — a workspace with no tags in it — and the two must not be the
   * same value, or a failed load would read as an empty vocabulary.
   */
  const [tagOptions, setTagOptions] = useState<WorkspaceLabel[] | null>(null);
  const [tagOptionsFailed, setTagOptionsFailed] = useState(false);
  const [addTagOpen, setAddTagOpen] = useState(false);

  /**
   * Which load is current.
   *
   * Two loads can be in flight at once, because the store changes the moment
   * the session resolves. Without this, a stale reply could land last and
   * win: a personal-scope request for an organization file 404s quickly, and
   * it was overwriting the successful organization reply with "File
   * unavailable". Only the newest run may write state.
   */
  const runRef = useRef(0);

  const load = useCallback(async () => {
    const run = ++runRef.current;
    const current = () => run === runRef.current;

    setLoading(true);
    try {
      const next = await fetchFileResource({ store, resourceId });
      if (!current()) return;
      setResource(next);
      setUnavailable(false);
    } catch {
      // A missing document and a denied one look the same on purpose: the
      // screen must not confirm that a file exists to someone who cannot
      // open it.
      if (current()) setUnavailable(true);
    } finally {
      if (current()) setLoading(false);
    }

    try {
      const relatedResult = await fetchRelatedFiles({ store, resourceId });
      if (!current()) return;
      setRelated(relatedResult.items);
      setRelatedState(relatedResult.state);
    } catch {
      if (current()) setRelatedState("unavailable");
    }
    // The dependency is the store's two *fields*, not the object identity,
    // which changes on every render.
    //
    // There was an `eslint-disable-next-line react-hooks/exhaustive-deps`
    // here. This repo lints with Biome, which does not read it — and its
    // own rule does not fire on this hook either, so the correct
    // `biome-ignore` is reported as an ineffective suppression. A comment
    // that explains the choice is all this needs; a suppression that
    // suppresses nothing only looks like protection.
  }, [resourceId, store.scope, store.organizationId]);

  useEffect(() => {
    // Waiting costs a moment of the loading state. Not waiting asks for the
    // file in the personal drive before the active organization is known,
    // which is a request we already know the answer to.
    if (sessionPending) return;
    void load();
  }, [load, sessionPending]);

  async function decide(suggestionId: string, decision: "accept" | "reject") {
    if (!resource) return;
    setBusy(true);
    try {
      const next = await decideSuggestion({
        store,
        resourceId,
        suggestionId,
        decision,
        expectedMetadataRevision: resource.metadataRevision,
      });
      setResource(next);
    } catch {
      toast.error(t("saveConflict"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(labelId: string) {
    if (!resource) return;
    setBusy(true);
    try {
      const next = await updateFileMetadata({
        store,
        resourceId,
        expectedMetadataRevision: resource.metadataRevision,
        removeTagLabelIds: [labelId],
      });
      setResource(next);
      toast.success(t("tagRemoved"));
    } catch {
      toast.error(t("saveConflict"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * The other half of the same edit, and the reason this control exists.
   *
   * Removing a tag writes a durable rejection, so the model stops
   * suggesting it — correctly: a person said no. But with nothing in the
   * web app passing `addTagLabelIds`, removal was a one-way door. There
   * was no undo, no add control here, nothing in the row menu or the bulk
   * bar, and reindex is deliberately not the way back. The endpoint has
   * always handled this and clears the rejection with it; only the client
   * was one-directional.
   */
  async function addTag(labelId: string) {
    if (!resource) return;
    setAddTagOpen(false);
    setBusy(true);
    try {
      const next = await updateFileMetadata({
        store,
        resourceId,
        expectedMetadataRevision: resource.metadataRevision,
        addTagLabelIds: [labelId],
      });
      setResource(next);
      toast.success(t("tagAdded"));
    } catch {
      // Identical to `removeTag`: the revision this page holds is from
      // whenever it last loaded, so a conflict means somebody else edited
      // the file and the only honest thing to show is the current state.
      toast.error(t("saveConflict"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function openTagPicker(open: boolean) {
    setAddTagOpen(open);
    if (!open || tagOptions) return;
    setTagOptionsFailed(false);
    try {
      // TAG only: the same endpoint serves categories, and a category in
      // a tag picker would be refused by the edit as the wrong kind.
      setTagOptions(await fetchWorkspaceLabels({ store, kind: "TAG" }));
    } catch {
      setTagOptionsFailed(true);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm">
        <Loader2 className="size-4 animate-spin" />
        {t("detailLoading")}
      </div>
    );
  }

  if (unavailable || !resource) {
    return (
      <div className="bg-card-background rounded-lg border p-10 text-center">
        <p className="text-sm font-medium">{t("unavailableTitle")}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("unavailableDescription")}
        </p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/drive?view=all">{t("backToFiles")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="file-detail">
      <div className="flex items-start gap-3">
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label={t("backToFiles")}
        >
          <Link href="/drive?view=all">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <span className="mt-1 size-6 shrink-0">
          <FileTypeIcon extension={fileExtension(resource.displayName)} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">
            {resource.displayName}
          </h1>
          <p className="text-muted-foreground text-xs">
            {resource.mimeType ?? t("unknownType")}
            {resource.sizeBytes !== null
              ? ` · ${Math.max(1, Math.round(resource.sizeBytes / 1024))} KB`
              : ""}
            {` · ${t(`source.${resource.sourceKind}`)}`}
          </p>
        </div>
      </div>

      <DriveFilePreview
        resourceId={resourceId}
        store={store}
        displayName={resource.displayName}
        mimeType={resource.mimeType}
        sizeBytes={resource.sizeBytes}
      />

      <section className="bg-card-background flex flex-col gap-4 rounded-lg border p-4">
        <div>
          <h2 className="text-sm font-medium">{t("detailProcessing")}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {resource.extractionState === "INDEXED"
              ? t("processingIndexed")
              : resource.extractionState === "PARTIAL"
                ? t("processingPartial")
                : resource.extractionState === "UNSUPPORTED"
                  ? (resource.extractionReason ?? t("processingUnsupported"))
                  : t("processingPending")}
          </p>
        </div>

        <div>
          <h2 className="text-sm font-medium">{t("detailCategory")}</h2>
          <div className="mt-1">
            {resource.category ? (
              <Badge variant="secondary">{resource.category.displayName}</Badge>
            ) : (
              <span className="text-muted-foreground text-sm">
                {t("uncategorized")}
              </span>
            )}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-medium">{t("detailTags")}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {resource.tags.length === 0 ? (
              <span className="text-muted-foreground text-sm">
                {t("noTags")}
              </span>
            ) : (
              resource.tags.map((tag) => (
                <Badge key={tag.id} variant="outline" className="gap-1">
                  {tag.displayName}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t("removeTag", { name: tag.displayName })}
                    onClick={() => void removeTag(tag.labelId)}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))
            )}

            <Popover open={addTagOpen} onOpenChange={openTagPicker}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  className="h-6 gap-1 px-2 text-xs"
                  data-testid="add-tag"
                >
                  <Plus className="size-3" />
                  {t("addTag")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-0">
                {tagOptionsFailed ? (
                  <div className="flex flex-col items-start gap-2 p-3">
                    <p className="text-muted-foreground text-sm">
                      {t("addTagUnavailable")}
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openTagPicker(true)}
                    >
                      {t("retry")}
                    </Button>
                  </div>
                ) : tagOptions === null ? (
                  <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
                    <Loader2 className="size-4 animate-spin" />
                    {t("detailLoading")}
                  </div>
                ) : (
                  <Command>
                    <CommandInput placeholder={t("addTagSearch")} />
                    <CommandList>
                      <CommandEmpty>{t("addTagEmpty")}</CommandEmpty>
                      <CommandGroup>
                        {/* Already on the file, so offering it again would
                            be a no-op the person cannot tell apart from a
                            failure. */}
                        {tagOptions
                          .filter(
                            (option) =>
                              !resource.tags.some(
                                (tag) => tag.labelId === option.id,
                              ),
                          )
                          .map((option) => (
                            <CommandItem
                              key={option.id}
                              value={option.displayName}
                              onSelect={() => void addTag(option.id)}
                            >
                              {option.displayName}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {resource.suggestions.length > 0 ? (
          <div>
            <h2 className="text-sm font-medium">{t("detailSuggestions")}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {resource.suggestions.map((suggestion) => (
                <li
                  key={suggestion.id}
                  className="flex flex-col gap-1 rounded-md border border-dashed p-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-dashed">
                      {t("suggestedLabel")}
                    </Badge>
                    <span className="text-sm font-medium">
                      {suggestion.displayName}
                    </span>
                    {suggestion.stale ? (
                      <span className="text-muted-foreground text-xs">
                        {t("suggestionStale")}
                      </span>
                    ) : null}
                  </div>
                  {suggestion.evidenceSnippet ? (
                    <p className="text-muted-foreground text-xs">
                      {t("suggestionExcerpt")}: “{suggestion.evidenceSnippet}”
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void decide(suggestion.id, "accept")}
                    >
                      <Check className="size-3" />
                      {t("suggestionAccept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void decide(suggestion.id, "reject")}
                    >
                      {t("suggestionDismiss")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <h2 className="text-sm font-medium">{t("detailProjects")}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("projectNoAccessChange")}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {resource.projects.length === 0 ? (
              <span className="text-muted-foreground text-sm">
                {t("noProjects")}
              </span>
            ) : (
              resource.projects.map((link) => (
                <Badge
                  key={link.id}
                  variant={link.state === "CONFIRMED" ? "secondary" : "outline"}
                >
                  {link.projectName}
                </Badge>
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium">{t("relatedHeading")}</h2>
        {relatedState === "not-indexed" ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {t("relatedNotIndexed")}
          </p>
        ) : relatedState === "unavailable" ? (
          <div className="mt-1 flex items-center gap-2">
            <p className="text-muted-foreground text-sm">
              {t("relatedUnavailable")}
            </p>
            <Button size="sm" variant="ghost" onClick={() => void load()}>
              {t("retry")}
            </Button>
          </div>
        ) : related.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {t("relatedEmpty")}
          </p>
        ) : (
          <ul className="divide-border bg-card-background mt-2 divide-y rounded-lg border">
            {related.map((item) => (
              <li key={item.id} className="flex items-start gap-3 p-3">
                <span className="mt-0.5 size-5 shrink-0">
                  <FileTypeIcon extension={fileExtension(item.displayName)} />
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/drive/files/${item.id}`}
                    className="block truncate text-sm font-medium"
                  >
                    {item.displayName}
                  </Link>
                  {item.relatedReason ? (
                    <p className="text-muted-foreground text-xs">
                      {item.relatedReason}
                    </p>
                  ) : item.snippet ? (
                    <DriveFileSnippet snippet={item.snippet} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

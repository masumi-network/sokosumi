"use client";

import type { FileResource } from "@sokosumi/core-client";
import { Check, Loader2, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { DriveFilePreview } from "@/app/drive/components/drive-file-preview";
import { DriveFileSnippet } from "@/app/drive/components/drive-file-snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { useSession } from "@/lib/auth/auth.client";
import { driveStoreForActiveWorkspace } from "@/lib/utils/drive-file-list.client";
import {
  decideSuggestion,
  type FileStore,
  fetchFileResource,
  fetchRelatedFiles,
  updateFileMetadata,
} from "@/lib/utils/file-search.client";

/**
 * One document: what it is, what it is about, and what else is like it.
 *
 * A suggestion is shown as a suggestion — outlined, labelled, with the
 * extracted span that justifies it — and confirming one says in words that
 * nobody gains access. Both are the point of the screen, not decoration.
 *
 * **One component, two hosts.** A sheet opened from a file row and the
 * `/drive/files/[resourceId]` route both render this. The detail page is no
 * longer the main way to see a file, but it stays as the shareable deep link —
 * and the two must not be two copies of this markup, because a copy drifts and
 * the drift is invisible until somebody notices the sheet and the page
 * disagreeing about the same document.
 *
 * The hosts differ in exactly two things, both props: what sits left of the
 * filename, and the heading level.
 */

/** Last dotted segment, lowercased. Empty for a name with no extension. */
function fileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toLowerCase() : "";
}

/**
 * Coverage as a whole percent a reader can act on, or null when there is
 * none recorded.
 *
 * Clamped to 1..99 on purpose, and the reason is at both ends.
 *
 * PARTIAL is set when `truncated || chunkCapped || source.truncated ||
 * wholeDocumentCoverage < 0.999`, so a document can be PARTIAL at 0.9995.
 * Rounding that to "about 100%" underneath "only part of this file is
 * indexed" is a sentence arguing with itself — the state and the number
 * would be contradicting each other in the same line.
 *
 * At the other end, a document that is PARTIAL has had *something* read
 * from it, so "about 0%" is false however small the fraction. A reader
 * seeing 0% would reasonably conclude nothing is searchable, which is a
 * different and worse claim than "a little is".
 *
 * Floored rather than rounded, so the number never promises more than was
 * actually read before the clamp takes over.
 */
function coveragePercent(coverage: number | null | undefined): number | null {
  if (typeof coverage !== "number" || !Number.isFinite(coverage)) return null;
  return Math.min(99, Math.max(1, Math.floor(coverage * 100)));
}

export interface FileDetailViewProps {
  resourceId: string;
  /**
   * Rendered to the left of the filename. The route puts a back link here and
   * the sheet puts nothing, because a sheet closes rather than navigating back.
   */
  leading?: ReactNode;
  /** The heading element, so a sheet can satisfy its own labelling contract. */
  headingAs?: "h1" | "h2";
}

export function FileDetailView({
  resourceId,
  leading,
  headingAs = "h1",
}: FileDetailViewProps) {
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

  /**
   * Withdraw the veto on one label, and nothing else.
   *
   * It re-opens the question; it does not answer it. No label row is written, no
   * state is changed and no provenance is set — the model has to decide again,
   * which is the whole difference between this and the manual add control that
   * used to sit here.
   *
   * Removing that control closed the only path that could clear a rejection, so
   * without this a wrong Remove would have been permanent with nothing able to
   * undo it. The two belong together or neither belongs.
   */
  async function allowAgain(labelId: string) {
    if (!resource) return;
    setBusy(true);
    try {
      const next = await updateFileMetadata({
        store,
        resourceId,
        expectedMetadataRevision: resource.metadataRevision,
        allowSuggestionsForLabelIds: [labelId],
      });
      setResource(next);
      toast.success(t("labelReopened"));
    } catch {
      // The revision this view holds is from whenever it last loaded, so a
      // conflict means somebody else edited the file and the only honest thing
      // to show is the current state.
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-pulse" />
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
          <Link href="/drive?view=workspace">{t("backToFiles")}</Link>
        </Button>
      </div>
    );
  }

  // Computed here rather than inline, so the clamp it carries has one
  // place to live and one place to be read.
  const partialPercent = coveragePercent(resource.extractionCoverage);
  const Heading = headingAs;

  return (
    <div className="flex flex-col gap-6" data-testid="file-detail">
      <div className="flex items-start gap-3">
        {leading}
        <span className="mt-1 size-6 shrink-0">
          <FileTypeIcon extension={fileExtension(resource.displayName)} />
        </span>
        <div className="min-w-0">
          <Heading className="truncate text-lg font-semibold">
            {resource.displayName}
          </Heading>
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
                ? /*
                   * How much, not just "some".
                   *
                   * This said only "Only part of this file is indexed",
                   * which reads the same at 50% as at 99% — on a 400-slide
                   * deck that is half the deck missing with nothing to say
                   * so. Core records the coverage and the web layer was
                   * throwing it away.
                   *
                   * Deliberately not `extractionReason`, which the
                   * UNSUPPORTED arm below renders: that string is composed
                   * in core in English, so showing it puts an English
                   * sentence on a German page. That is a pre-existing flaw
                   * in one arm and not something to spread to a second.
                   * A number localises by itself.
                   */
                  partialPercent !== null
                  ? t("processingPartialCoverage", {
                      percent: partialPercent,
                    })
                  : t("processingPartial")
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
          </div>
        </div>

        {resource.rejected.length > 0 ? (
          <div>
            <h2 className="text-sm font-medium">{t("detailRejected")}</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {t("rejectedExplainer")}
            </p>
            <div
              className="mt-1 flex flex-wrap items-center gap-1"
              data-testid="file-detail-rejected"
            >
              {resource.rejected.map((entry) => (
                <Badge
                  key={entry.id}
                  variant="outline"
                  className="text-muted-foreground gap-1 border-dashed"
                >
                  {entry.displayName}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={t("allowAgain", { name: entry.displayName })}
                    data-testid="file-detail-allow-again"
                    onClick={() => void allowAgain(entry.labelId)}
                  >
                    <RotateCcw className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

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
        ) : relatedState === "no-text" ? (
          /*
           * Terminal, and said as terminal.
           *
           * This case used to arrive as "not-indexed" and render "Related
           * files will appear when processing finishes" — directly below
           * a Processing panel explaining that this PDF is a scan and
           * text is not read from images. Two panels on one page
           * contradicting each other, with the one that was wrong being
           * the one that asked the reader to wait for something that was
           * never coming.
           *
           * Not `relatedEmpty`: "No related files yet" keeps the "yet".
           */
          <p className="text-muted-foreground mt-1 text-sm">
            {t("relatedNoText")}
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

"use client";

import { ImageOff, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { assetContentUrl, type StudioAsset, type StudioLabels } from "./types";

/** How long to wait before the one automatic retry. */
const RETRY_DELAY_MS = 400;

/**
 * What happened to one version's bytes, and how sure we are.
 *
 * `gone` is the only state that may say the file was deleted, and it is only
 * ever reached by asking the route and being told 404.
 */
type Outcome = "gone" | "unreadable";

interface Attempt {
  assetId: string;
  /** 0 is the first load, 1 is the single automatic retry. */
  attempt: number;
  /** Bumped by "Try again", so the URL differs and the browser refetches. */
  reload: number;
  outcome: Outcome | null;
}

/**
 * A stored image, or an honest account of why it is not on screen.
 *
 * `onError` on an `img` says nothing about *why*. It fires for a 404, and it
 * fires for an aborted or slow response — which five large PNGs decoding at once
 * produce routinely. This component used to read it as proof the object had been
 * deleted, so on the preview two of five freshly generated images rendered
 * "no longer in storage" while all five content routes answered 200, and a
 * reload showed every one of them. A false claim, permanent for the session, and
 * the one claim a person cannot check.
 *
 * So: retry once, quietly, before saying anything. If that fails too, ask the
 * route what it actually thinks — the route already distinguishes a 404 from the
 * 503 it returns when the store is unreadable — and only say "deleted" when it
 * says 404. Everything else is "could not load", with a way to try again, which
 * is both true and actionable.
 */
export function StudioImage({
  asset,
  className,
  fit = "cover",
  labels,
  projectId,
}: {
  asset: StudioAsset;
  className?: string;
  fit?: "cover" | "contain";
  labels: Pick<
    StudioLabels,
    "bytesUnavailable" | "imageUnreadable" | "imageRetry"
  >;
  projectId: string;
}) {
  /**
   * Keyed by asset id, not a bare flag.
   *
   * The single-image lightbox reuses this component as its arrows move between
   * versions, so a failure that outlived the version it was about marked every
   * version stepped to afterwards as broken — the placeholder stayed and no
   * `img` was created for the next URL. Reading through the id makes the state
   * false again the moment a different version renders, and correctly true
   * again on the way back to the broken one.
   */
  const [state, setState] = useState<Attempt | null>(null);
  const current = state?.assetId === asset.id ? state : null;
  const attempt = current?.attempt ?? 0;
  const reload = current?.reload ?? 0;
  const outcome = current?.outcome ?? null;

  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  const base = assetContentUrl(projectId, asset.id);

  /**
   * Ask the route what it thinks, now that the `img` has failed twice.
   *
   * `HEAD` because the answer wanted is the status, not the bytes; Next serves
   * it from the same handler. A network failure here is itself evidence that the
   * problem is not a deletion.
   */
  async function classify(assetId: string, at: number) {
    let next: Outcome = "unreadable";
    try {
      const response = await fetch(base, {
        method: "HEAD",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 404) next = "gone";
    } catch {
      // Left as `unreadable`: we never learned anything about the object.
    }
    setState({ assetId, attempt: at, reload, outcome: next });
  }

  function handleError() {
    if (attempt === 0) {
      // Quietly, and only once. A short delay rather than an immediate refetch
      // because the common cause is contention, and retrying into it is how one
      // slow load becomes two.
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        setState({ assetId: asset.id, attempt: 1, reload, outcome: null });
      }, RETRY_DELAY_MS);
      return;
    }
    void classify(asset.id, attempt);
  }

  if (outcome !== null) {
    return (
      <span
        className={cn(
          "bg-muted text-muted-foreground flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center",
          className,
        )}
      >
        <ImageOff aria-hidden className="size-4" />
        <span className="text-xs leading-snug">
          {outcome === "gone"
            ? labels.bytesUnavailable
            : labels.imageUnreadable}
        </span>
        {outcome === "unreadable" ? (
          <Button
            onClick={(event) => {
              // The gallery wraps this whole tile in a button that opens the
              // lightbox, so without this a press of Try again also threw the
              // reader into the full-screen viewer — recovering a thumbnail is
              // not a request to look at it.
              event.stopPropagation();
              event.preventDefault();
              setState({
                assetId: asset.id,
                attempt: 0,
                reload: reload + 1,
                outcome: null,
              });
            }}
            size="sm"
            variant="ghost"
          >
            <RefreshCw aria-hidden />
            {labels.imageRetry}
          </Button>
        ) : null}
      </span>
    );
  }

  return (
    <img
      alt={asset.prompt}
      className={cn(
        fit === "cover"
          ? "size-full object-cover"
          : "max-h-full max-w-full object-contain",
        className,
      )}
      loading="lazy"
      onError={handleError}
      // The query only changes when this component means to force a fresh
      // request — the automatic retry, or a press of "Try again". The route
      // ignores it; the browser does not, which is the point: without it a
      // failed entry is simply served again.
      src={
        attempt === 0 && reload === 0
          ? base
          : `${base}?reload=${reload}-${attempt}`
      }
    />
  );
}

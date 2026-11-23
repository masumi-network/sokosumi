"use client";

import type { FileResource } from "@sokosumi/core-client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FileStore,
  fetchFileResource,
  fetchRelatedFiles,
} from "@/lib/utils/file-search.client";

export interface DriveFileDetailState {
  resource: FileResource | null;
  setResource: (resource: FileResource | null) => void;
  related: FileResource[];
  relatedState: string;
  loading: boolean;
  unavailable: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads one Drive file's metadata and related files outside React Query for
 * `FileDetailView`, aborting in-flight requests on unmount or scope change.
 */
export function useDriveFileDetail({
  resourceId,
  store,
  sessionPending,
}: {
  resourceId: string;
  store: FileStore;
  sessionPending: boolean;
}): DriveFileDetailState {
  const [resource, setResource] = useState<FileResource | null>(null);
  const [related, setRelated] = useState<FileResource[]>([]);
  const [relatedState, setRelatedState] = useState<string>("ok");
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const storeScope = store.scope;
  const storeOrganizationId =
    store.scope === "org" ? store.organizationId : undefined;

  /**
   * Which load is current.
   *
   * Two loads can be in flight at once, because the store changes the moment
   * the session resolves. Without aborting the earlier run, a stale reply
   * could land last and win: a personal-scope request for an organization file
   * 404s quickly, and it was overwriting the successful organization reply
   * with "File unavailable". Only the newest run may write state.
   */
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () =>
      !controller.signal.aborted && controllerRef.current === controller;
    const requestStore: FileStore =
      storeScope === "org"
        ? { scope: "org", organizationId: storeOrganizationId }
        : { scope: "me" };

    setLoading(true);
    try {
      const next = await fetchFileResource({
        store: requestStore,
        resourceId,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      setResource(next);
      setUnavailable(false);
    } catch {
      // A missing document and a denied one look the same on purpose: the
      // screen must not confirm that a file exists to someone who cannot
      // open it.
      if (!isCurrent()) return;
      setUnavailable(true);
      return;
    } finally {
      if (isCurrent()) setLoading(false);
    }

    if (!isCurrent()) return;

    try {
      const relatedResult = await fetchRelatedFiles({
        store: requestStore,
        resourceId,
        signal: controller.signal,
      });
      if (!isCurrent()) return;
      setRelated(relatedResult.items);
      setRelatedState(relatedResult.state);
    } catch {
      if (isCurrent()) setRelatedState("unavailable");
    }
  }, [resourceId, storeScope, storeOrganizationId]);

  useEffect(() => {
    // Waiting costs a moment of the loading state. Not waiting asks for the
    // file in the personal drive before the active organization is known,
    // which is a request we already know the answer to.
    if (sessionPending) return;
    void load();
    return () => {
      controllerRef.current?.abort();
    };
  }, [load, sessionPending]);

  return {
    resource,
    setResource,
    related,
    relatedState,
    loading,
    unavailable,
    reload: load,
  };
}

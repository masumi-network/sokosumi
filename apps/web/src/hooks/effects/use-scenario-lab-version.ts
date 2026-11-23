"use client";

import type { SokoBotVersion } from "@sokosumi/core-client";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { setSokoBotVersionAction } from "@/lib/actions/soko-bot/action";

interface UseScenarioLabVersionOptions {
  versionId: string | null;
  versions: SokoBotVersion[];
  onTurnFinished?: () => void;
}

/**
 * Owns `ScenarioLab`'s active bot version, URL `?version=` deep-link sync, and
 * picker switch mutations against Core.
 */
export function useScenarioLabVersion({
  versionId,
  versions,
  onTurnFinished,
}: UseScenarioLabVersionOptions) {
  const [activeVersion, setActiveVersion] = useState<string | null>(versionId);
  const activeVersionRef = useRef<string | null>(versionId);
  const [requestedVersionId, setRequestedVersionId] = useQueryState(
    "version",
    parseAsString.withOptions({ history: "replace" }),
  );
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fallbackVersionId = versionId ?? versions[0]?.id ?? null;
    const requested = versions.some(
      (version) => version.id === requestedVersionId,
    )
      ? requestedVersionId
      : null;
    if (requestedVersionId && !requested) {
      void setRequestedVersionId(null);
    }
    if (!requested || requested === activeVersionRef.current) {
      activeVersionRef.current = requested ?? fallbackVersionId;
      setActiveVersion(requested ?? fallbackVersionId);
      return;
    }

    setSwitching(true);
    void setSokoBotVersionAction({ versionId: requested }).then(
      (switchResult) => {
        if (cancelled) return;
        setSwitching(false);
        if (!switchResult.ok) {
          void setRequestedVersionId(null);
          return;
        }
        activeVersionRef.current = requested;
        setActiveVersion(requested);
        onTurnFinished?.();
      },
      // A server action rejects instead of answering with a result when the
      // POST comes back as something other than RSC. Release the switch, or
      // the picker stays disabled.
      () => {
        if (cancelled) return;
        setSwitching(false);
        void setRequestedVersionId(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    onTurnFinished,
    requestedVersionId,
    setRequestedVersionId,
    versionId,
    versions,
  ]);

  async function chooseVersion(id: string) {
    setSwitching(true);
    const result = await setSokoBotVersionAction({ versionId: id });
    setSwitching(false);
    if (result.ok) {
      activeVersionRef.current = id;
      setActiveVersion(id);
      await setRequestedVersionId(id);
      onTurnFinished?.();
    }
  }

  return {
    activeVersion,
    switching,
    chooseVersion,
  };
}

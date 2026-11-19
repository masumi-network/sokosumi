"use client";

import type {
  GetUsersByIdPreferencesResponse,
  SidebarLayout,
} from "@sokosumi/core-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { preferencesBrowserClient } from "@/lib/clients/core.preferences.browser.client";
import {
  getMyPreferencesQueryKey,
  getMyPreferencesQueryOptions,
} from "@/queries/preferences";
import { isNewSidebarFeature } from "./layout/sidebar-layout";

type SidebarChange =
  | { sidebarLayout: SidebarLayout | null }
  | { sidebarSeenItem: string };

export function useAccountSidebarLayout(userId: string) {
  const client = useQueryClient();
  const preferences = useQuery(getMyPreferencesQueryOptions(userId));
  const pendingSeen = useRef(new Set<string>());
  const t = useTranslations("App.Sidebar.Layout");
  // Undefined closes the editor. Null is a staged reset that still needs Save.
  const [draft, setDraft] = useState<SidebarLayout | null | undefined>(
    undefined,
  );
  const [saving, setSaving] = useState(false);
  const layout = preferences.data?.data.sidebarLayout ?? null;
  const write = useMutation({
    scope: { id: `sidebar-layout-${userId}` },
    mutationFn: (change: SidebarChange) =>
      preferencesBrowserClient.patchMyPreferences(change, userId),
    onSuccess: async (written, change) => {
      // A focus refetch can have read the layout before this save.
      await client.cancelQueries({
        queryKey: getMyPreferencesQueryKey(userId),
        exact: true,
      });
      client.setQueryData<GetUsersByIdPreferencesResponse>(
        getMyPreferencesQueryKey(userId),
        (current) => {
          if (!current) return written;
          // A seen receipt can return after another tab or preference control
          // saved a layout. Only merge the fields this request changed.
          const data = { ...current.data };
          if ("sidebarLayout" in change)
            data.sidebarLayout = written.data.sidebarLayout ?? null;
          data.sidebarSeenItems = [
            ...new Set([
              ...(data.sidebarSeenItems ?? []),
              ...(written.data.sidebarSeenItems ?? []),
            ]),
          ];
          return { ...current, data };
        },
      );
    },
  });

  function isUnseen(id: string) {
    return (
      preferences.isSuccess &&
      isNewSidebarFeature(id) &&
      !preferences.data.data.sidebarSeenItems?.includes(id)
    );
  }

  function markSeen(id: string) {
    if (!isUnseen(id) || pendingSeen.current.has(id)) return;
    pendingSeen.current.add(id);
    void write
      .mutateAsync({ sidebarSeenItem: id })
      .catch(() => {
        // The indicator stays visible. The next visit or click can retry.
      })
      .finally(() => pendingSeen.current.delete(id));
  }

  async function save() {
    if (saving || draft === undefined) return;
    setSaving(true);
    try {
      await write.mutateAsync({ sidebarLayout: draft });
      setDraft(undefined);
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return {
    preferences,
    currentLayout: draft === undefined ? layout : draft,
    editing: draft !== undefined,
    edit: () => setDraft(layout),
    cancel: () => setDraft(undefined),
    setDraft,
    save,
    saving,
    isUnseen,
    markSeen,
  };
}

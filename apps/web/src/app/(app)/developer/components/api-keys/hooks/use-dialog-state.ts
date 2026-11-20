"use client";

import { useCallback, useState } from "react";

import { useTimeout } from "@/hooks/effects/use-timeout";

import type { ApiKeyRecord, DialogState } from "../types";
import { DIALOG_CLEANUP_TIMEOUT } from "../utils";

export function useDialogState(): DialogState {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [clearCreateGeneration, setClearCreateGeneration] = useState(0);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKeyRecord | null>(null);
  const [clearDeleteGeneration, setClearDeleteGeneration] = useState(0);

  const setCreateOpen = useCallback((open: boolean) => {
    setCreateDialogOpen(open);
    if (!open) {
      setClearCreateGeneration((generation) => generation + 1);
    }
  }, []);

  const setDeleteOpen = useCallback((open: boolean) => {
    setDeleteDialogOpen(open);
    if (!open) {
      setClearDeleteGeneration((generation) => generation + 1);
    }
  }, []);

  useTimeout(
    () => {
      setCreatedKey(null);
      setClearCreateGeneration(0);
    },
    clearCreateGeneration > 0 ? DIALOG_CLEANUP_TIMEOUT : null,
    clearCreateGeneration,
  );

  useTimeout(
    () => {
      setKeyToDelete(null);
      setClearDeleteGeneration(0);
    },
    clearDeleteGeneration > 0 ? DIALOG_CLEANUP_TIMEOUT : null,
    clearDeleteGeneration,
  );

  return {
    createDialog: {
      open: createDialogOpen,
      setOpen: setCreateOpen,
      createdKey,
      setCreatedKey,
    },
    deleteDialog: {
      open: deleteDialogOpen,
      setOpen: setDeleteOpen,
      keyToDelete,
      setKeyToDelete,
    },
  };
}

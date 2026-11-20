"use client";

import { useCallback, useState } from "react";

import { useScheduledTimeout } from "@/hooks/effects/use-scheduled-timeout";

import type { ApiKeyRecord, DialogState } from "../types";
import { DIALOG_CLEANUP_TIMEOUT } from "../utils";

export function useDialogState(): DialogState {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKeyRecord | null>(null);

  const dialogTimeout = useScheduledTimeout();
  const deleteTimeout = useScheduledTimeout();

  const clearDialogStateWithDelay = useCallback(() => {
    dialogTimeout.schedule(() => {
      setCreatedKey(null);
    }, DIALOG_CLEANUP_TIMEOUT);
  }, [dialogTimeout]);

  const setCreateOpen = useCallback(
    (open: boolean) => {
      setCreateDialogOpen(open);
      if (!open) {
        clearDialogStateWithDelay();
      }
    },
    [clearDialogStateWithDelay],
  );

  const setDeleteOpen = useCallback(
    (open: boolean) => {
      setDeleteDialogOpen(open);
      if (!open) {
        deleteTimeout.schedule(() => {
          setKeyToDelete(null);
        }, DIALOG_CLEANUP_TIMEOUT);
      }
    },
    [deleteTimeout],
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

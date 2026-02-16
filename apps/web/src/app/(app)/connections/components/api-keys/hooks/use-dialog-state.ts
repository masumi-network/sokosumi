"use client";

import { Apikey } from "@sokosumi/database";
import { useCallback, useEffect, useRef, useState } from "react";

import { DialogState } from "@/app/connections/components/api-keys/types";
import { DIALOG_CLEANUP_TIMEOUT } from "@/app/connections/components/api-keys/utils";

export function useDialogState(): DialogState {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<Apikey | null>(null);

  const dialogTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearDialogStateWithDelay = useCallback(() => {
    if (dialogTimeoutRef.current) {
      clearTimeout(dialogTimeoutRef.current);
    }

    dialogTimeoutRef.current = setTimeout(() => {
      setCreatedKey(null);
      dialogTimeoutRef.current = null;
    }, DIALOG_CLEANUP_TIMEOUT);
  }, []);

  const setCreateOpen = useCallback(
    (open: boolean) => {
      setCreateDialogOpen(open);
      if (!open) {
        clearDialogStateWithDelay();
      }
    },
    [clearDialogStateWithDelay],
  );

  const setDeleteOpen = useCallback((open: boolean) => {
    setDeleteDialogOpen(open);
    if (!open) {
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
      }
      deleteTimeoutRef.current = setTimeout(() => {
        setKeyToDelete(null);
        deleteTimeoutRef.current = null;
      }, DIALOG_CLEANUP_TIMEOUT);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (dialogTimeoutRef.current) {
        clearTimeout(dialogTimeoutRef.current);
      }
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
      }
    };
  }, []);

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

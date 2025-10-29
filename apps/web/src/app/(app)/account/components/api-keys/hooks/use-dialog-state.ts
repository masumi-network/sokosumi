"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DialogState } from "@/app/account/components/api-keys/types";
import { DIALOG_CLEANUP_TIMEOUT } from "@/app/account/components/api-keys/utils";
import { Apikey } from "@/prisma/generated/client";

/**
 * Custom hook for managing dialog states
 * Handles create and delete dialog state management with cleanup
 */
export function useDialogState(): DialogState {
  // Create dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<Apikey | null>(null);

  // Timeout refs for cleanup
  const dialogTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Clear dialog state with a delay to allow for smooth transitions
   */
  const clearDialogStateWithDelay = useCallback(() => {
    if (dialogTimeoutRef.current) {
      clearTimeout(dialogTimeoutRef.current);
    }

    dialogTimeoutRef.current = setTimeout(() => {
      setCreatedKey(null);
      dialogTimeoutRef.current = null;
    }, DIALOG_CLEANUP_TIMEOUT);
  }, []);

  /**
   * Enhanced create dialog setOpen that handles cleanup
   */
  const setCreateOpen = useCallback(
    (open: boolean) => {
      setCreateDialogOpen(open);
      if (!open) {
        // Reset all state when dialog closes
        clearDialogStateWithDelay();
      }
    },
    [clearDialogStateWithDelay],
  );

  /**
   * Enhanced delete dialog setOpen that handles cleanup
   */
  const setDeleteOpen = useCallback((open: boolean) => {
    setDeleteDialogOpen(open);
    if (!open) {
      // Clear any existing delete timeout
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
      }
      // Reset delete state when dialog closes
      deleteTimeoutRef.current = setTimeout(() => {
        setKeyToDelete(null);
        deleteTimeoutRef.current = null;
      }, DIALOG_CLEANUP_TIMEOUT);
    }
  }, []);

  // Cleanup timeouts on unmount
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

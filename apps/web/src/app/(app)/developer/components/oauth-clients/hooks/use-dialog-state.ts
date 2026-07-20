"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreatedOAuthClientCredentials,
  OAuthClientDialogState,
  OAuthClientRecord,
} from "@/app/developer/components/oauth-clients/types";
import { DIALOG_CLEANUP_TIMEOUT } from "@/app/developer/components/oauth-clients/utils";

export function useDialogState(): OAuthClientDialogState {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createdCredentials, setCreatedCredentials] =
    useState<CreatedOAuthClientCredentials | null>(null);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [clientToEdit, setClientToEdit] = useState<OAuthClientRecord | null>(
    null,
  );

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [clientToDelete, setClientToDelete] =
    useState<OAuthClientRecord | null>(null);

  const createTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const deleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const clearCreateStateWithDelay = useCallback(() => {
    if (createTimeoutRef.current) {
      clearTimeout(createTimeoutRef.current);
    }

    createTimeoutRef.current = setTimeout(() => {
      setCreatedCredentials(null);
      createTimeoutRef.current = null;
    }, DIALOG_CLEANUP_TIMEOUT);
  }, []);

  const setCreateOpen = useCallback(
    (open: boolean) => {
      setCreateDialogOpen(open);
      if (!open) {
        clearCreateStateWithDelay();
      }
    },
    [clearCreateStateWithDelay],
  );

  const setEditOpen = useCallback((open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      if (editTimeoutRef.current) {
        clearTimeout(editTimeoutRef.current);
      }
      editTimeoutRef.current = setTimeout(() => {
        setClientToEdit(null);
        editTimeoutRef.current = null;
      }, DIALOG_CLEANUP_TIMEOUT);
    }
  }, []);

  const setDeleteOpen = useCallback((open: boolean) => {
    setDeleteDialogOpen(open);
    if (!open) {
      if (deleteTimeoutRef.current) {
        clearTimeout(deleteTimeoutRef.current);
      }
      deleteTimeoutRef.current = setTimeout(() => {
        setClientToDelete(null);
        deleteTimeoutRef.current = null;
      }, DIALOG_CLEANUP_TIMEOUT);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (createTimeoutRef.current) {
        clearTimeout(createTimeoutRef.current);
      }
      if (editTimeoutRef.current) {
        clearTimeout(editTimeoutRef.current);
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
      createdCredentials,
      setCreatedCredentials,
    },
    editDialog: {
      open: editDialogOpen,
      setOpen: setEditOpen,
      clientToEdit,
      setClientToEdit,
    },
    deleteDialog: {
      open: deleteDialogOpen,
      setOpen: setDeleteOpen,
      clientToDelete,
      setClientToDelete,
    },
  };
}

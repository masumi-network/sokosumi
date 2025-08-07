"use client";

import { useCallback } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Apikey } from "@/prisma/generated/client";

import { ApiKeysHeader } from "./api-keys-header";
import { ApiKeysList } from "./api-keys-list";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { DeleteApiKeyDialog } from "./delete-api-key-dialog";
import { useApiKeys } from "./hooks/use-api-keys";
import { useDialogState } from "./hooks/use-dialog-state";
import { CreateApiKeyResult } from "./types";

/**
 * Main API Keys management section component
 * Orchestrates all API key operations and UI components
 */
export function ApiKeysSection() {
  const {
    apiKeys,
    isInitialLoading,
    create,
    update,
    delete: deleteApiKey,
  } = useApiKeys();
  const dialogState = useDialogState();

  /**
   * Handle create button click
   */
  const handleCreateClick = useCallback(() => {
    dialogState.createDialog.setOpen(true);
  }, [dialogState.createDialog]);

  /**
   * Handle successful API key creation
   */
  const handleCreateSuccess = useCallback(
    (result: CreateApiKeyResult) => {
      if (result.success && result.data) {
        dialogState.createDialog.setCreatedKey(result.data.key);
      }
    },
    [dialogState.createDialog],
  );

  /**
   * Handle API key status toggle (enable/disable)
   */
  const handleToggleStatus = useCallback(
    async (apiKey: Apikey) => {
      await update({
        keyId: apiKey.id,
        enabled: !apiKey.enabled,
      });
    },
    [update],
  );

  /**
   * Handle delete button click
   */
  const handleDeleteClick = useCallback(
    (apiKey: Apikey) => {
      dialogState.deleteDialog.setKeyToDelete(apiKey);
      dialogState.deleteDialog.setOpen(true);
    },
    [dialogState.deleteDialog],
  );

  /**
   * Handle successful API key deletion
   */
  const handleDeleteSuccess = useCallback(() => {
    // API key list will be refreshed automatically by the delete operation
    dialogState.deleteDialog.setKeyToDelete(null);
  }, [dialogState.deleteDialog]);

  return (
    <Card>
      <ApiKeysHeader onCreateClick={handleCreateClick} />

      <CardContent>
        <ApiKeysList
          apiKeys={apiKeys}
          isInitialLoading={isInitialLoading}
          onToggleStatus={handleToggleStatus}
          onDeleteClick={handleDeleteClick}
        />

        <CreateApiKeyDialog
          open={dialogState.createDialog.open}
          onOpenChange={dialogState.createDialog.setOpen}
          onSuccess={handleCreateSuccess}
          createApiKey={create}
        />

        <DeleteApiKeyDialog
          apiKey={dialogState.deleteDialog.keyToDelete}
          open={dialogState.deleteDialog.open}
          onOpenChange={dialogState.deleteDialog.setOpen}
          onSuccess={handleDeleteSuccess}
          deleteApiKey={deleteApiKey}
        />
      </CardContent>
    </Card>
  );
}

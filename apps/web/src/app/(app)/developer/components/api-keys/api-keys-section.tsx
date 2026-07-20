"use client";

import { useCallback } from "react";

import { Card, CardContent } from "@/components/ui/card";

import { ApiKeysHeader } from "./api-keys-header";
import { ApiKeysList } from "./api-keys-list";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import { DeleteApiKeyDialog } from "./delete-api-key-dialog";
import { useApiKeys } from "./hooks/use-api-keys";
import { useDialogState } from "./hooks/use-dialog-state";
import type { ApiKeyRecord, CreateApiKeyResult } from "./types";

export function ApiKeysSection() {
  const {
    apiKeys,
    isInitialLoading,
    error,
    refresh,
    create,
    update,
    delete: deleteApiKey,
  } = useApiKeys();
  const dialogState = useDialogState();

  const handleRetry = useCallback(() => {
    void refresh(true);
  }, [refresh]);

  const handleCreateClick = useCallback(() => {
    dialogState.createDialog.setOpen(true);
  }, [dialogState.createDialog]);

  const handleCreateSuccess = useCallback(
    (result: CreateApiKeyResult) => {
      if (result.success && result.data) {
        dialogState.createDialog.setCreatedKey(result.data.key);
      }
    },
    [dialogState.createDialog],
  );

  const handleToggleStatus = useCallback(
    async (apiKey: ApiKeyRecord) => {
      await update({
        keyId: apiKey.id,
        enabled: !apiKey.enabled,
      });
    },
    [update],
  );

  const handleDeleteClick = useCallback(
    (apiKey: ApiKeyRecord) => {
      dialogState.deleteDialog.setKeyToDelete(apiKey);
      dialogState.deleteDialog.setOpen(true);
    },
    [dialogState.deleteDialog],
  );

  const handleDeleteSuccess = useCallback(() => {
    dialogState.deleteDialog.setKeyToDelete(null);
  }, [dialogState.deleteDialog]);

  return (
    <Card>
      <ApiKeysHeader onCreateClick={handleCreateClick} />

      <CardContent>
        <ApiKeysList
          apiKeys={apiKeys}
          isInitialLoading={isInitialLoading}
          error={error}
          onRetry={handleRetry}
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

"use client";

import { useCallback } from "react";

import { Card, CardContent } from "@/components/ui/card";

import { CreateOAuthClientDialog } from "./create-oauth-client-dialog";
import { DeleteOAuthClientDialog } from "./delete-oauth-client-dialog";
import { EditOAuthClientDialog } from "./edit-oauth-client-dialog";
import { useDialogState } from "./hooks/use-dialog-state";
import { useOAuthClients } from "./hooks/use-oauth-clients";
import { OAuthClientsHeader } from "./oauth-clients-header";
import { OAuthClientsList } from "./oauth-clients-list";
import type { CreateOAuthClientResult, OAuthClientRecord } from "./types";

export function OAuthClientsSection() {
  const {
    clients,
    isInitialLoading,
    create,
    update,
    delete: deleteClient,
  } = useOAuthClients();
  const dialogState = useDialogState();

  const handleCreateClick = useCallback(() => {
    dialogState.createDialog.setOpen(true);
  }, [dialogState.createDialog]);

  const handleCreateSuccess = useCallback(
    (result: CreateOAuthClientResult) => {
      if (result.success && result.data) {
        dialogState.createDialog.setCreatedCredentials(result.data);
      }
    },
    [dialogState.createDialog],
  );

  const handleEditClick = useCallback(
    (client: OAuthClientRecord) => {
      dialogState.editDialog.setClientToEdit(client);
      dialogState.editDialog.setOpen(true);
    },
    [dialogState.editDialog],
  );

  const handleDeleteClick = useCallback(
    (client: OAuthClientRecord) => {
      dialogState.deleteDialog.setClientToDelete(client);
      dialogState.deleteDialog.setOpen(true);
    },
    [dialogState.deleteDialog],
  );

  const handleDeleteSuccess = useCallback(() => {
    dialogState.deleteDialog.setClientToDelete(null);
  }, [dialogState.deleteDialog]);

  const handleEditSuccess = useCallback(() => {
    dialogState.editDialog.setClientToEdit(null);
  }, [dialogState.editDialog]);

  return (
    <Card>
      <OAuthClientsHeader onCreateClick={handleCreateClick} />

      <CardContent>
        <OAuthClientsList
          clients={clients}
          isInitialLoading={isInitialLoading}
          onEditClick={handleEditClick}
          onDeleteClick={handleDeleteClick}
        />

        <CreateOAuthClientDialog
          open={dialogState.createDialog.open}
          onOpenChange={dialogState.createDialog.setOpen}
          onSuccess={handleCreateSuccess}
          createClient={create}
        />

        <EditOAuthClientDialog
          client={dialogState.editDialog.clientToEdit}
          open={dialogState.editDialog.open}
          onOpenChange={dialogState.editDialog.setOpen}
          onSuccess={handleEditSuccess}
          updateClient={update}
        />

        <DeleteOAuthClientDialog
          client={dialogState.deleteDialog.clientToDelete}
          open={dialogState.deleteDialog.open}
          onOpenChange={dialogState.deleteDialog.setOpen}
          onSuccess={handleDeleteSuccess}
          deleteClient={deleteClient}
        />
      </CardContent>
    </Card>
  );
}

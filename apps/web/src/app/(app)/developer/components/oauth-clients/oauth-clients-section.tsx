"use client";

import { useCallback, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";

import { CreateOAuthClientDialog } from "./create-oauth-client-dialog";
import { DeleteOAuthClientDialog } from "./delete-oauth-client-dialog";
import { EditOAuthClientDialog } from "./edit-oauth-client-dialog";
import { useOAuthClients } from "./hooks/use-oauth-clients";
import { OAuthClientsHeader } from "./oauth-clients-header";
import { OAuthClientsList } from "./oauth-clients-list";
import type { OAuthClientRecord } from "./types";

export function OAuthClientsSection() {
  const {
    clients,
    isInitialLoading,
    error,
    refresh,
    create,
    update,
    delete: deleteClient,
  } = useOAuthClients();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clientToEdit, setClientToEdit] = useState<OAuthClientRecord | null>(
    null,
  );
  const [clientToDelete, setClientToDelete] =
    useState<OAuthClientRecord | null>(null);

  const handleCreateClick = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handleEditClick = useCallback((client: OAuthClientRecord) => {
    setClientToEdit(client);
    setEditOpen(true);
  }, []);

  const handleDeleteClick = useCallback((client: OAuthClientRecord) => {
    setClientToDelete(client);
    setDeleteOpen(true);
  }, []);

  const handleRetry = useCallback(() => {
    void refresh(true);
  }, [refresh]);

  return (
    <Card>
      <OAuthClientsHeader onCreateClick={handleCreateClick} />

      <CardContent>
        <OAuthClientsList
          clients={clients}
          isInitialLoading={isInitialLoading}
          error={error}
          onRetry={handleRetry}
          onEditClick={handleEditClick}
          onDeleteClick={handleDeleteClick}
        />

        <CreateOAuthClientDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          createClient={create}
        />

        <EditOAuthClientDialog
          client={clientToEdit}
          open={editOpen}
          onOpenChange={(open) => {
            setEditOpen(open);
            if (!open) {
              setClientToEdit(null);
            }
          }}
          onSuccess={() => setClientToEdit(null)}
          updateClient={update}
        />

        <DeleteOAuthClientDialog
          client={clientToDelete}
          open={deleteOpen}
          onOpenChange={(open) => {
            setDeleteOpen(open);
            if (!open) {
              setClientToDelete(null);
            }
          }}
          onSuccess={() => setClientToDelete(null)}
          deleteClient={deleteClient}
        />
      </CardContent>
    </Card>
  );
}

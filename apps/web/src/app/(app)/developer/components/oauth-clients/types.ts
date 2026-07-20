import type { useTranslations } from "next-intl";

import type { authClient } from "@/lib/auth/auth.client";

export type OAuthClientRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.oauth2.getClients>>["data"]
>[number];

export interface CreateOAuthClientFormData {
  name: string;
  redirectUris: string;
}

export interface EditOAuthClientFormData {
  name: string;
  redirectUris: string;
}

export interface CreateOAuthClientRequest {
  name: string;
  redirectUris: string[];
}

export interface CreatedOAuthClientCredentials {
  clientId: string;
  clientSecret: string | null;
}

export interface CreateOAuthClientResult {
  success: boolean;
  data?: CreatedOAuthClientCredentials;
  error?: {
    message: string;
  };
}

export interface UpdateOAuthClientRequest {
  clientId: string;
  name: string;
  redirectUris: string[];
}

export interface DeleteOAuthClientRequest {
  clientId: string;
}

export interface UseOAuthClientsReturn {
  clients: OAuthClientRecord[];
  isInitialLoading: boolean;
  error: string | null;
  refresh: (isInitial?: boolean) => Promise<void>;
  create: (data: CreateOAuthClientRequest) => Promise<CreateOAuthClientResult>;
  update: (data: UpdateOAuthClientRequest) => Promise<boolean>;
  delete: (data: DeleteOAuthClientRequest) => Promise<boolean>;
}

export interface OAuthClientsHeaderProps {
  onCreateClick: () => void;
}

export interface OAuthClientsListProps {
  clients: OAuthClientRecord[];
  isInitialLoading: boolean;
  onEditClick: (client: OAuthClientRecord) => void;
  onDeleteClick: (client: OAuthClientRecord) => void;
}

export interface CreateOAuthClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: CreateOAuthClientResult) => void;
  createClient: (
    data: CreateOAuthClientRequest,
  ) => Promise<CreateOAuthClientResult>;
}

export interface EditOAuthClientDialogProps {
  client: OAuthClientRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  updateClient: (data: UpdateOAuthClientRequest) => Promise<boolean>;
}

export interface DeleteOAuthClientDialogProps {
  client: OAuthClientRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  deleteClient: (data: DeleteOAuthClientRequest) => Promise<boolean>;
}

export interface CredentialsOnceDisplayProps {
  credentials: CreatedOAuthClientCredentials;
  onClose: () => void;
}

export interface OAuthClientDialogState {
  createDialog: {
    open: boolean;
    setOpen: (open: boolean) => void;
    createdCredentials: CreatedOAuthClientCredentials | null;
    setCreatedCredentials: (
      credentials: CreatedOAuthClientCredentials | null,
    ) => void;
  };
  editDialog: {
    open: boolean;
    setOpen: (open: boolean) => void;
    clientToEdit: OAuthClientRecord | null;
    setClientToEdit: (client: OAuthClientRecord | null) => void;
  };
  deleteDialog: {
    open: boolean;
    setOpen: (open: boolean) => void;
    clientToDelete: OAuthClientRecord | null;
    setClientToDelete: (client: OAuthClientRecord | null) => void;
  };
}

export type TranslationFunction = ReturnType<typeof useTranslations>;

export interface OAuthClientActionCallbacks {
  onEditClick: (client: OAuthClientRecord) => void;
  onDeleteClick: (client: OAuthClientRecord) => void;
}

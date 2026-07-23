import type { useTranslations } from "next-intl";

import type { authClient } from "@/lib/auth/auth.client";

export type OAuthClientRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.oauth2.getClients>>["data"]
>[number];

export interface CreateOAuthClientFormData {
  name: string;
  redirectUris: string;
  /** When true, client may request `sokosumi:api` (Core `/v1` access). */
  includeCoreApi: boolean;
}

export interface EditOAuthClientFormData {
  name: string;
  redirectUris: string;
}

export interface CreateOAuthClientRequest {
  name: string;
  redirectUris: string[];
  /** When true, register with `openid sokosumi:api`; otherwise `openid` only. */
  includeCoreApi?: boolean;
}

export interface CreateOAuthClientResult {
  success: boolean;
  data?: {
    clientId: string;
    clientSecret: string | null;
  };
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

export interface RotateOAuthClientRequest {
  clientId: string;
}

export interface RotateOAuthClientResult {
  success: boolean;
  data?: {
    clientId: string;
    clientSecret: string | null;
  };
  error?: {
    message: string;
  };
}

export interface UseOAuthClientsReturn {
  clients: OAuthClientRecord[];
  isInitialLoading: boolean;
  error: string | null;
  refresh: (isInitial?: boolean) => Promise<void>;
  create: (data: CreateOAuthClientRequest) => Promise<CreateOAuthClientResult>;
  update: (data: UpdateOAuthClientRequest) => Promise<boolean>;
  delete: (data: DeleteOAuthClientRequest) => Promise<boolean>;
  rotateSecret: (
    data: RotateOAuthClientRequest,
  ) => Promise<RotateOAuthClientResult>;
}

export interface OAuthClientsHeaderProps {
  onCreateClick: () => void;
}

export interface OAuthClientsListProps {
  clients: OAuthClientRecord[];
  isInitialLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onEditClick: (client: OAuthClientRecord) => void;
  onRotateClick: (client: OAuthClientRecord) => void;
  onDeleteClick: (client: OAuthClientRecord) => void;
}

export interface CreateOAuthClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (result: CreateOAuthClientResult) => void;
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

export interface RotateOAuthClientDialogProps {
  client: OAuthClientRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  rotateSecret: (
    data: RotateOAuthClientRequest,
  ) => Promise<RotateOAuthClientResult>;
}

export type TranslationFunction = ReturnType<typeof useTranslations>;

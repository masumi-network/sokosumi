import type { useTranslations } from "next-intl";

import type { authClient } from "@/lib/auth/auth.client";

export type ApiKeyRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.apiKey.list>>["data"]
>["apiKeys"][number];

export interface CreateApiKeyFormData {
  name: string;
}

export interface DeleteApiKeyFormData {
  keyId: string;
  confirmName: string;
}

export interface CreateApiKeyRequest {
  name: string;
}

export interface CreateApiKeyResult {
  success: boolean;
  data?: {
    key: string;
  };
  error?: {
    message: string;
  };
}

export interface UpdateApiKeyRequest {
  keyId: string;
  enabled: boolean;
}

export interface DeleteApiKeyRequest {
  keyId: string;
}

export interface UseApiKeysReturn {
  apiKeys: ApiKeyRecord[];
  isInitialLoading: boolean;
  error: string | null;
  refresh: (isInitial?: boolean) => Promise<void>;
  create: (data: CreateApiKeyRequest) => Promise<CreateApiKeyResult>;
  update: (data: UpdateApiKeyRequest) => Promise<boolean>;
  delete: (data: DeleteApiKeyRequest) => Promise<boolean>;
}

export interface DialogState {
  createDialog: {
    open: boolean;
    setOpen: (open: boolean) => void;
    createdKey: string | null;
    setCreatedKey: (key: string | null) => void;
  };
  deleteDialog: {
    open: boolean;
    setOpen: (open: boolean) => void;
    keyToDelete: ApiKeyRecord | null;
    setKeyToDelete: (key: ApiKeyRecord | null) => void;
  };
}

export interface ApiKeysHeaderProps {
  onCreateClick: () => void;
}

export interface ApiKeysListProps {
  apiKeys: ApiKeyRecord[];
  isInitialLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onToggleStatus: (apiKey: ApiKeyRecord) => Promise<void>;
  onDeleteClick: (apiKey: ApiKeyRecord) => void;
}

export interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: CreateApiKeyResult) => void;
  createApiKey: (data: CreateApiKeyRequest) => Promise<CreateApiKeyResult>;
}

export interface DeleteApiKeyDialogProps {
  apiKey: ApiKeyRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  deleteApiKey: (data: DeleteApiKeyRequest) => Promise<boolean>;
}

export interface ApiKeySuccessDisplayProps {
  apiKey: string;
  onClose: () => void;
}

export type TranslationFunction = ReturnType<typeof useTranslations>;

export interface ApiKeyActionCallbacks {
  onToggleStatus: (apiKey: ApiKeyRecord) => Promise<void>;
  onDeleteClick: (apiKey: ApiKeyRecord) => void;
}

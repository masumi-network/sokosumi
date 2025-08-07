import { useTranslations } from "next-intl";

import { Apikey } from "@/prisma/generated/client";

// Form types
export interface CreateApiKeyFormData {
  name: string;
}

export interface DeleteApiKeyFormData {
  keyId: string;
  confirmName: string;
}

// API operation types
export interface CreateApiKeyRequest {
  name: string;
}

export interface CreateApiKeyResult {
  success: boolean;
  data?: {
    key: string;
    apiKey: Apikey;
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

// Hook return types
export interface UseApiKeysReturn {
  apiKeys: Apikey[];
  isInitialLoading: boolean;
  error: string | null;
  refresh: (isInitial?: boolean) => Promise<void>;
  create: (data: CreateApiKeyRequest) => Promise<CreateApiKeyResult>;
  update: (data: UpdateApiKeyRequest) => Promise<boolean>;
  delete: (data: DeleteApiKeyRequest) => Promise<boolean>;
}

export interface UseClipboardReturn {
  copied: boolean;
  copy: (text: string) => Promise<void>;
  reset: () => void;
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
    keyToDelete: Apikey | null;
    setKeyToDelete: (key: Apikey | null) => void;
  };
}

// Component prop types
export interface ApiKeysHeaderProps {
  onCreateClick: () => void;
}

export interface ApiKeysListProps {
  apiKeys: Apikey[];
  isInitialLoading: boolean;
  onToggleStatus: (apiKey: Apikey) => Promise<void>;
  onDeleteClick: (apiKey: Apikey) => void;
}

export interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: CreateApiKeyResult) => void;
  createApiKey: (data: CreateApiKeyRequest) => Promise<CreateApiKeyResult>;
}

export interface DeleteApiKeyDialogProps {
  apiKey: Apikey | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  deleteApiKey: (data: DeleteApiKeyRequest) => Promise<boolean>;
}

export interface ApiKeySuccessDisplayProps {
  apiKey: string;
  onClose: () => void;
}

// Utility types
export type TranslationFunction = ReturnType<typeof useTranslations>;

export interface ApiKeyActionCallbacks {
  onToggleStatus: (apiKey: Apikey) => Promise<void>;
  onDeleteClick: (apiKey: Apikey) => void;
}

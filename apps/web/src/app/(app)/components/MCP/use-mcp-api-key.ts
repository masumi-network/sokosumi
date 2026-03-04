"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { ApiKeyRecord } from "@/app/connections/components/api-keys/types";
import { getEnvPublicConfig } from "@/config/env.public";
import { authClient } from "@/lib/auth/auth.client";

interface UseMcpApiKeyReturn {
  mcpUrl: string | null;
  isLoading: boolean;
  error: string | null;
  generateMcpUrl: () => Promise<void>;
  retryLoad: () => void;
  enableKey: () => Promise<void>;
  isKeyExisting: boolean;
  isKeyDisabled: boolean;
}

const MCP_KEY_NAME = "MCP";

function buildMcpUrl(apiKey: string, network: string): string {
  const baseUrl = getEnvPublicConfig().NEXT_PUBLIC_MCP_URL;
  return `${baseUrl}/mcp?api_key=${apiKey}&network=${network}`;
}

function getPersonalMcpKeys(apiKeys: ApiKeyRecord[]): ApiKeyRecord[] {
  return apiKeys.filter(
    (key) => key.name === MCP_KEY_NAME && (key.configId ?? "default") === "default",
  );
}

function getLastTouchedAtMs(apiKey: ApiKeyRecord): number {
  const timestamp = new Date(apiKey.updatedAt ?? apiKey.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function selectCanonicalMcpKey(apiKeys: ApiKeyRecord[]): ApiKeyRecord | null {
  const candidates = getPersonalMcpKeys(apiKeys);
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((a, b) => {
    const enabledRank = Number(Boolean(b.enabled)) - Number(Boolean(a.enabled));
    if (enabledRank !== 0) {
      return enabledRank;
    }

    const lastTouchedRank = getLastTouchedAtMs(b) - getLastTouchedAtMs(a);
    if (lastTouchedRank !== 0) {
      return lastTouchedRank;
    }

    return b.id.localeCompare(a.id);
  })[0];
}

export function useMcpApiKey(
  open: boolean,
  _activeOrganizationId: string | null,
): UseMcpApiKeyReturn {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isKeyExisting, setIsExistingKey] = useState<boolean>(false);
  const [isKeyDisabled, setIsKeyDisabled] = useState<boolean>(false);
  const [existingKeyId, setExistingKeyId] = useState<string | null>(null);

  const t = useTranslations("App.MCP");
  const network = getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
  const existingKeyUrl = buildMcpUrl(t("existingKey"), network);

  const resetState = useCallback(() => {
    setMcpUrl(null);
    setIsExistingKey(false);
    setIsKeyDisabled(false);
    setExistingKeyId(null);
    setError(null);
  }, []);

  const loadExistingKey = useCallback(async () => {
    setError(null);

    try {
      const result = await authClient.apiKey.list();
      const mcpKey = result.data
        ? selectCanonicalMcpKey(result.data.apiKeys)
        : null;

      if (!mcpKey) {
        return;
      }

      setIsExistingKey(true);
      setExistingKeyId(mcpKey.id);

      if (mcpKey.enabled) {
        setMcpUrl(existingKeyUrl);
        setIsKeyDisabled(false);
      } else {
        setMcpUrl(null);
        setIsKeyDisabled(true);
      }
    } catch (error) {
      console.error("Failed to check existing MCP key:", error);
      const errorMessage =
        "Failed to load MCP connection information. Please try again.";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [existingKeyUrl]);

  // Effect is necessary: Fetches data from external system (API) when dialog opens.
  useEffect(() => {
    if (!open) {
      return;
    }

    resetState();
    setIsLoading(true);
    void loadExistingKey();
  }, [open, loadExistingKey, resetState]);

  const generateMcpUrl = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    try {
      const listResult = await authClient.apiKey.list();
      if (!listResult.data) {
        const errorMessage =
          listResult.error?.message ?? "Failed to load existing MCP keys";
        setError(errorMessage);
        toast.error(errorMessage);
        return;
      }

      const mcpKeys = getPersonalMcpKeys(listResult.data.apiKeys);
      await Promise.all(
        mcpKeys.map((key) =>
          authClient.apiKey.delete({
            keyId: key.id,
          }),
        ),
      );

      const result = await authClient.apiKey.create({
        name: MCP_KEY_NAME,
      });

      if (result.data) {
        const url = buildMcpUrl(result.data.key, network);
        setMcpUrl(url);
        setIsExistingKey(false); // This is a new key
        setIsKeyDisabled(false); // Reset disabled state
        setExistingKeyId(result.data.id); // Store new key ID
        toast.success("MCP connection URL generated successfully!");
      } else {
        const errorMessage =
          result.error?.message ?? "Failed to generate MCP URL";
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      console.error("Failed to generate MCP URL:", error);
      const errorMessage = "Failed to generate MCP URL. Please try again.";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, network]);

  const enableKey = useCallback(async () => {
    if (!existingKeyId || isLoading) return;

    setIsLoading(true);
    setError(null);
    try {
      const result = await authClient.apiKey.update({
        keyId: existingKeyId,
        enabled: true,
      });

      if (result.data) {
        // Show the URL for the now-enabled key
        setMcpUrl(existingKeyUrl);
        setIsKeyDisabled(false);
        toast.success("MCP connection enabled successfully!");
      } else {
        const errorMessage =
          result.error?.message ?? "Failed to enable MCP key";
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      console.error("Failed to enable MCP key:", error);
      const errorMessage = "Failed to enable MCP key. Please try again.";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [existingKeyId, existingKeyUrl, isLoading]);

  const retryLoad = useCallback(() => {
    resetState();
    setIsLoading(true);
    void loadExistingKey();
  }, [loadExistingKey, resetState]);

  return {
    mcpUrl,
    isLoading,
    error,
    generateMcpUrl,
    retryLoad,
    enableKey,
    isKeyExisting,
    isKeyDisabled,
  };
}

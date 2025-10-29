"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getEnvPublicConfig } from "@/config/env.public";
import { authClient } from "@/lib/auth/auth.client";
import { Apikey } from "@/prisma/generated/client";

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

export function useMcpApiKey(
  open: boolean,
  activeOrganizationId: string | null,
): UseMcpApiKeyReturn {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isKeyExisting, setIsExistingKey] = useState<boolean>(false);
  const [isKeyDisabled, setIsKeyDisabled] = useState<boolean>(false);
  const [existingKeyId, setExistingKeyId] = useState<string | null>(null);

  const t = useTranslations("App.MCP");

  // Effect is necessary: Fetches data from external system (API) when dialog opens
  // Resets state and fetches fresh data based on organization context
  useEffect(() => {
    if (open) {
      // Reset states when dialog opens
      setMcpUrl(null);
      setIsExistingKey(false);
      setIsKeyDisabled(false);
      setExistingKeyId(null);
      setError(null);
      setIsLoading(true);

      const checkExistingKey = async () => {
        setError(null);
        try {
          const result = await authClient.apiKey.list();
          if (result.data) {
            // Look for MCP key matching current organization context (regardless of enabled status)
            const mcpKey = (result.data as Apikey[]).find((key) => {
              if (key.name !== MCP_KEY_NAME) return false;

              // Check organization context match
              const keyOrgId =
                (key.metadata as { organizationId?: string })?.organizationId ??
                null;
              return keyOrgId === activeOrganizationId;
            });
            if (mcpKey) {
              setIsExistingKey(true);
              setExistingKeyId(mcpKey.id);

              if (mcpKey.enabled) {
                // Show URL for enabled key
                const network =
                  getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
                setMcpUrl(buildMcpUrl(t("existingKey"), network));
              } else {
                // Key exists but is disabled
                setIsKeyDisabled(true);
              }
            }
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
      };

      checkExistingKey();
    }
  }, [open, activeOrganizationId, t]);

  const generateMcpUrl = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    try {
      // If there's an existing key (disabled or enabled), delete it first
      if (existingKeyId) {
        await authClient.apiKey.delete({
          keyId: existingKeyId,
        });
      }

      // Generate new API key with organization scope if active
      const metadata = activeOrganizationId
        ? { organizationId: activeOrganizationId }
        : undefined;

      const result = await authClient.apiKey.create({
        name: MCP_KEY_NAME,
        metadata,
      });

      if (result.data) {
        const network = getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
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
  }, [isLoading, activeOrganizationId, existingKeyId]);

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
        const network = getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
        setMcpUrl(buildMcpUrl(t("existingKey"), network));
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
  }, [existingKeyId, isLoading, t]);

  const retryLoad = useCallback(() => {
    setError(null);
    setMcpUrl(null);
    setIsExistingKey(false);
    setIsKeyDisabled(false);
    setExistingKeyId(null);
    setIsLoading(true);

    // Re-run the check for existing keys
    const checkExistingKey = async () => {
      setError(null);
      try {
        const result = await authClient.apiKey.list();
        if (result.data) {
          // Look for MCP key matching current organization context (regardless of enabled status)
          const mcpKey = (result.data as Apikey[]).find((key) => {
            if (key.name !== MCP_KEY_NAME) return false;

            // Check organization context match
            const keyOrgId =
              (key.metadata as { organizationId?: string })?.organizationId ??
              null;
            return keyOrgId === activeOrganizationId;
          });
          if (mcpKey) {
            setIsExistingKey(true);
            setExistingKeyId(mcpKey.id);

            if (mcpKey.enabled) {
              // Show URL for enabled key
              const network =
                getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
              setMcpUrl(buildMcpUrl(t("existingKey"), network));
            } else {
              // Key exists but is disabled
              setIsKeyDisabled(true);
            }
          }
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
    };

    checkExistingKey();
  }, [activeOrganizationId, t]);

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

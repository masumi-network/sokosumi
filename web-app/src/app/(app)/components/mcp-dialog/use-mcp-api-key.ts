"use client";

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
  isKeyExisting: boolean;
}

const MCP_KEY_NAME = "MCP";

export function useMcpApiKey(open: boolean): UseMcpApiKeyReturn {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isKeyExisting, setIsExistingKey] = useState<boolean>(false);

  // Check for existing MCP key when dialog opens
  useEffect(() => {
    if (open) {
      // Reset states when dialog opens
      setMcpUrl(null);
      setIsExistingKey(false);
      setError(null);
      setIsLoading(true);

      const checkExistingKey = async () => {
        setError(null);
        try {
          const result = await authClient.apiKey.list();
          if (result.data) {
            const mcpKey = (result.data as Apikey[]).find(
              (key) => key.name === MCP_KEY_NAME && key.enabled,
            );
            if (mcpKey) {
              setIsExistingKey(true);
              // Reconstruct URL for existing key (we don't store the actual key value)
              const network =
                getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
              setMcpUrl(
                `https://mcp.sokosumi.com/mcp?api_key=sk_****...****&network=${network}`,
              );
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
  }, [open]);

  const generateMcpUrl = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    try {
      // Generate new API key
      const result = await authClient.apiKey.create({
        name: MCP_KEY_NAME,
      });

      if (result.data) {
        const network = getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
        const url = `https://mcp.sokosumi.com/mcp?api_key=${result.data.key}&network=${network}`;
        setMcpUrl(url);
        setIsExistingKey(false); // This is a new key
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
  }, [isLoading]);

  const retryLoad = useCallback(() => {
    setError(null);
    setMcpUrl(null);
    setIsExistingKey(false);
    setIsLoading(true);

    // Re-run the check for existing keys
    const checkExistingKey = async () => {
      setError(null);
      try {
        const result = await authClient.apiKey.list();
        if (result.data) {
          const mcpKey = (result.data as Apikey[]).find(
            (key) => key.name === MCP_KEY_NAME && key.enabled,
          );
          if (mcpKey) {
            setIsExistingKey(true);
            // Reconstruct URL for existing key (we don't store the actual key value)
            const network =
              getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
            setMcpUrl(
              `https://mcp.sokosumi.com/mcp?api_key=sk_****...****&network=${network}`,
            );
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
  }, []);

  return {
    mcpUrl,
    isLoading,
    error,
    generateMcpUrl,
    retryLoad,
    isKeyExisting,
  };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { getEnvPublicConfig } from "@/config/env.public";
import { authClient } from "@/lib/auth/auth.client";
import { Apikey } from "@/prisma/generated/client";

interface UseMcpApiKeyReturn {
  mcpUrl: string | null;
  isLoading: boolean;
  generateMcpUrl: () => Promise<void>;
  isKeyExisting: boolean;
}

const MCP_KEY_NAME = "MCP";

export function useMcpApiKey(open: boolean): UseMcpApiKeyReturn {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isKeyExisting, setIsExistingKey] = useState<boolean>(false);

  // Check for existing MCP key when dialog opens
  useEffect(() => {
    if (open) {
      // Reset states when dialog opens
      setMcpUrl(null);
      setIsExistingKey(false);
      setIsLoading(true);

      const checkExistingKey = async () => {
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
                `https://mcp.sokosumi.com/mcp?api_key=YOUR_EXISTING_KEY&network=${network}`,
              );
            }
          }
        } catch (error) {
          console.error("Failed to check existing MCP key:", error);
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
    try {
      // Generate new API key
      const result = await authClient.apiKey.create({
        name: MCP_KEY_NAME,
      });

      if (result.data) {
        const network = getEnvPublicConfig().NEXT_PUBLIC_NETWORK.toLowerCase();
        const url = `https://mcp.sokosumi.com/mcp?api_key=${result.data.key}&network=${network}`;
        setMcpUrl(url);
        toast.success("MCP connection URL generated successfully!");
      } else {
        toast.error(result.error?.message ?? "Failed to generate MCP URL");
      }
    } catch (error) {
      console.error("Failed to generate MCP URL:", error);
      toast.error("Failed to generate MCP URL. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  return {
    mcpUrl,
    isLoading,
    generateMcpUrl,
    isKeyExisting,
  };
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { getEnvPublicConfig } from "@/config/env.public";

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

function buildMcpUrl(): string {
  const baseUrl = getEnvPublicConfig().NEXT_PUBLIC_MCP_URL.replace(/\/$/, "");
  return `${baseUrl}/mcp`;
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

  const resetState = useCallback(() => {
    setMcpUrl(null);
    setIsExistingKey(false);
    setIsKeyDisabled(false);
    setError(null);
  }, []);

  const loadMcpConnection = useCallback(() => {
    setError(null);
    setMcpUrl(buildMcpUrl());
    setIsExistingKey(false);
    setIsKeyDisabled(false);
    setIsLoading(false);
  }, []);

  // Effect is necessary: syncs the displayed MCP URL with the connection view.
  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }

    resetState();
    setIsLoading(true);
    loadMcpConnection();
  }, [open, loadMcpConnection, resetState]);

  const generateMcpUrl = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);
    setMcpUrl(buildMcpUrl());
    setIsExistingKey(false);
    setIsKeyDisabled(false);
    setIsLoading(false);
  }, [isLoading]);

  const enableKey = useCallback(async () => {
    await generateMcpUrl();
  }, [generateMcpUrl]);

  const retryLoad = useCallback(() => {
    resetState();
    setIsLoading(true);
    loadMcpConnection();
  }, [loadMcpConnection, resetState]);

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

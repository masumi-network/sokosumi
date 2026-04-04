"use client";

import { HardDrive, Loader2, Plug, Unplug } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getBrowserCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url.browser";

interface GoogleDriveStatus {
  connected: boolean;
  email: string | null;
}

export function GoogleDriveConnection() {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const coreApiBaseUrl = getBrowserCoreApiBaseUrl();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `${coreApiBaseUrl}/v1/users/me/google-drive/status`,
        { credentials: "include" },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          data: GoogleDriveStatus;
        };
        setStatus(json.data);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [coreApiBaseUrl]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(
        `${coreApiBaseUrl}/v1/users/me/google-drive/connect`,
        {
          method: "POST",
          credentials: "include",
        },
      );
      if (res.ok) {
        const json = (await res.json()) as { data: { url: string } };
        window.location.href = json.data.url;
        return;
      }
    } catch {
      // ignore
    }
    setActionLoading(false);
  };

  const handleDisconnect = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(
        `${coreApiBaseUrl}/v1/users/me/google-drive/disconnect`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (res.ok) {
        setStatus({ connected: false, email: null });
      }
    } catch {
      // ignore
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border p-4">
        <HardDrive className="h-6 w-6 shrink-0" />
        <p className="flex-1 text-sm">Google Drive</p>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border p-4">
      <HardDrive className="h-6 w-6 shrink-0" />
      <div className="flex flex-1 flex-col">
        <p className="text-sm font-medium">Google Drive</p>
        {status?.connected ? (
          <p className="text-muted-foreground text-xs">
            Connected{status.email ? ` as ${status.email}` : ""}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">Not connected</p>
        )}
      </div>
      <Button
        disabled={actionLoading}
        variant={status?.connected ? "destructive" : "outline"}
        className={actionLoading ? "animate-pulse" : ""}
        size="icon"
        onClick={() => {
          if (status?.connected) {
            void handleDisconnect();
          } else {
            void handleConnect();
          }
        }}
      >
        {status?.connected ? <Unplug /> : <Plug />}
      </Button>
    </div>
  );
}

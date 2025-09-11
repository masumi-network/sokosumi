"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { McpSetupInstructions } from "./mcp-setup-instructions";
import { McpUrlDisplay } from "./mcp-url-display";
import { useMcpApiKey } from "./use-mcp-api-key";

interface McpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeOrganizationId: string | null;
}

export function McpDialog({
  open,
  onOpenChange,
  activeOrganizationId,
}: McpDialogProps) {
  const t = useTranslations("App.MCP");
  const {
    mcpUrl,
    isLoading,
    error,
    generateMcpUrl,
    retryLoad,
    enableKey,
    isKeyExisting,
    isKeyDisabled,
  } = useMcpApiKey(open, activeOrganizationId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
                <div>
                  <p className="text-sm text-red-700">{t("loadError")}</p>
                </div>
              </div>
              <Button onClick={retryLoad} variant="outline" className="w-full">
                {t("retry")}
              </Button>
            </div>
          ) : isKeyDisabled ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm text-amber-700">{t("keyDisabled")}</p>
                  <p className="text-xs text-amber-600">
                    {t("keyDisabledNote")}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  {activeOrganizationId
                    ? t("organizationScope")
                    : t("personalScope")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={enableKey}
                  disabled={isLoading}
                  variant="outline"
                  className="flex-1"
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("enableKey")}
                </Button>
                <Button
                  onClick={generateMcpUrl}
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {t("createNewKey")}
                </Button>
              </div>
            </div>
          ) : mcpUrl ? (
            <>
              <McpUrlDisplay url={mcpUrl} />
              <div className="space-y-2">
                {isKeyExisting && (
                  <p className="text-muted-foreground text-xs">
                    {t("existingKeyNote")}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {activeOrganizationId
                    ? t("organizationScope")
                    : t("personalScope")}
                </p>
              </div>
              <McpSetupInstructions />
            </>
          ) : (
            <div className="space-y-4">
              <Button
                onClick={generateMcpUrl}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("generateButton")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

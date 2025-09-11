"use client";

import { Loader2 } from "lucide-react";
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
}

export function McpDialog({ open, onOpenChange }: McpDialogProps) {
  const t = useTranslations("App.Mcp");
  const { mcpUrl, isGenerating, isLoading, generateMcpUrl, existingKey } =
    useMcpApiKey();

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
          ) : mcpUrl ? (
            <>
              <McpUrlDisplay url={mcpUrl} />
              {existingKey && (
                <p className="text-muted-foreground text-xs">
                  {t("existingKeyNote")}
                </p>
              )}
              <McpSetupInstructions />
            </>
          ) : (
            <div className="space-y-4">
              <Button
                onClick={generateMcpUrl}
                disabled={isGenerating}
                className="w-full"
              >
                {isGenerating && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("generateButton")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

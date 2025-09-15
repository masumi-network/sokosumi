import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { McpSetupInstructions } from "@/app/components/MCP/mcp-setup-instructions";
import { McpUrlDisplay } from "@/app/components/MCP/mcp-url-display";
import { Button } from "@/components/ui/button";

import { McpKeyNotes } from "./mcp-key-notes";

interface McpActiveKeyViewProps {
  mcpUrl: string;
  isKeyExisting: boolean;
  onRegenerate: () => void;
  isLoading: boolean;
}

export function McpActiveKeyView({
  mcpUrl,
  isKeyExisting,
  onRegenerate,
  isLoading,
}: McpActiveKeyViewProps) {
  const t = useTranslations("App.MCP");

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("urlLabel")}</p>
        <McpUrlDisplay url={mcpUrl} />
        <McpKeyNotes isKeyExisting={isKeyExisting} />
      </div>
      {isKeyExisting && (
        <div className="flex justify-end">
          <Button
            onClick={onRegenerate}
            disabled={isLoading}
            variant="outline"
            size="sm"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("regenerateKey")}
          </Button>
        </div>
      )}
      <McpSetupInstructions />
    </>
  );
}

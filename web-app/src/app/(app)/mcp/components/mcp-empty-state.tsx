import { Loader2 } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface McpEmptyStateProps {
  onGenerate: () => void;
  isLoading: boolean;
}

export function McpEmptyState({ onGenerate, isLoading }: McpEmptyStateProps) {
  const t = useTranslations("App.MCP");

  return (
    <div className="space-y-6">
      <Button onClick={onGenerate} disabled={isLoading} className="w-full">
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("generateButton")}
      </Button>

      {/* Setup Preview */}
      <div className="space-y-3">
        <h4 className="text-muted-foreground text-sm font-medium">
          {t("setupPreviewTitle")}
        </h4>
        <div className="bg-muted/30 rounded-lg border p-4">
          <Image
            src="/images/mcp-setup-demo.gif"
            alt="MCP Setup Demo - Visual guide showing how to connect Claude to Sokosumi"
            width={600}
            height={400}
            className="w-full rounded-md"
            unoptimized // Allows GIFs to animate
          />
        </div>
      </div>
    </div>
  );
}

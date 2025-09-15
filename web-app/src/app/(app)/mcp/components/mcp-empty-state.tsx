import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface McpEmptyStateProps {
  onGenerate: () => void;
  isLoading: boolean;
}

export function McpEmptyState({ onGenerate, isLoading }: McpEmptyStateProps) {
  const t = useTranslations("App.MCP");

  return (
    <div className="space-y-4">
      <Button onClick={onGenerate} disabled={isLoading} className="w-full">
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t("generateButton")}
      </Button>
    </div>
  );
}

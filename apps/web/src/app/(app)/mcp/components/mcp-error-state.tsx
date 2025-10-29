import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface McpErrorStateProps {
  error: string;
  onRetry: () => void;
}

export function McpErrorState({ error, onRetry }: McpErrorStateProps) {
  const t = useTranslations("App.MCP");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-4">
        <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
        <div>
          <p className="text-sm text-red-700">{error || t("loadError")}</p>
        </div>
      </div>
      <Button onClick={onRetry} variant="outline" className="w-full">
        {t("retry")}
      </Button>
    </div>
  );
}

import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface McpDisabledKeyStateProps {
  onEnableKey: () => void;
  onGenerateNew: () => void;
  isLoading: boolean;
}

export function McpDisabledKeyState({
  onEnableKey,
  onGenerateNew,
  isLoading,
}: McpDisabledKeyStateProps) {
  const t = useTranslations("App.MCP");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-4">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm text-amber-700">{t("keyDisabled")}</p>
          <p className="text-xs text-amber-600">{t("keyDisabledNote")}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={onEnableKey}
          disabled={isLoading}
          variant="outline"
          className="flex-1"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("enableKey")}
        </Button>
        <Button onClick={onGenerateNew} disabled={isLoading} className="flex-1">
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("createNewKey")}
        </Button>
      </div>
    </div>
  );
}

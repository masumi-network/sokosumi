import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { SokosumiIcon } from "@/components/masumi-icons";
import { Button } from "@/components/ui/button";

export default function AgentAddButton() {
  const t = useTranslations("App.Sidebar.Footer.AgentAddButton");

  return (
    <div className="flex items-center gap-2 p-2">
      <SokosumiIcon />
      <div className="flex flex-1 flex-col">
        <h2 className="text-muted-foreground text-base font-bold">
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-xs">{t("subtitle")}</p>
      </div>
      <Button variant="outline" size="icon">
        <Plus />
      </Button>
    </div>
  );
}

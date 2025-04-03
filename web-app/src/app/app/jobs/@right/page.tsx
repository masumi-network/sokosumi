import { getTranslations } from "next-intl/server";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export default async function RightPage() {
  const t = await getTranslations("App.JobsSelected");
  return (
    <div className={cn("flex h-full min-h-[300px] flex-1 flex-col")}>
      <ScrollArea className="h-[calc(100%)] overflow-y-scroll rounded-md border p-4 px-8">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("NoJobSelected")}</p>
      </ScrollArea>
    </div>
  );
}

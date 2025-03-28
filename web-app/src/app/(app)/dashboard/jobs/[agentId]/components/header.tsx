import { Bookmark, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";

interface HeaderProps {
  agent: AgentDTO;
}

export function HeaderSkeleton() {
  const t = useTranslations("App.Job.Header");

  return (
    <div className="flex flex-wrap items-center gap-4 lg:gap-6 xl:gap-8">
      <Bookmark size={36} className="cursor-pointer" />
      <Skeleton className="h-10 w-60" />
      <Button className="gap-2">
        <Plus />
        {t("createNewJob")}
      </Button>
      <Skeleton className="h-10 w-30" />
    </div>
  );
}

export default function Header({ agent }: HeaderProps) {
  const t = useTranslations("App.Job.Header");
  const { name, credits } = agent;

  return (
    <div className="flex flex-wrap items-center gap-4 lg:gap-6 xl:gap-8">
      <Bookmark size={36} className="cursor-pointer" />
      <h1 className="text-2xl font-bold xl:text-3xl">{name}</h1>
      <Button className="gap-2">
        <Plus />
        {t("createNewJob")}
      </Button>
      <div className="text-base">{t("price", { price: credits })}</div>
    </div>
  );
}

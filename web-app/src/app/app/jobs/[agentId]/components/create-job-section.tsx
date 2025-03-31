import Image from "next/image";
import { useTranslations } from "next-intl";

import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";

interface CreateJobSectionProps {
  agent: AgentDTO;
}

export default function CreateJobSection({ agent }: CreateJobSectionProps) {
  const t = useTranslations("App.Jobs.CreateJob");
  const { description } = agent;

  return (
    <div className="flex h-full min-h-[300px] flex-1 flex-col">
      <h1 className="h-[30px] text-xl font-bold">{t("title")}</h1>
      <ScrollArea className="h-[calc(100%-30px)] rounded-md border p-4">
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[200px] flex-1 text-base">{description}</div>
            <Image
              src="/placeholder.svg"
              alt="Example Output"
              className="h-60 w-60 shrink-0 rounded-lg object-cover"
              width={240}
              height={240}
            />
          </div>
          {/* inputs */}
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold">{t("Input.title")}</h1>
            <p className="text-base">{t("Input.description")}</p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

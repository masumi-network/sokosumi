import Image from "next/image";
import { useTranslations } from "next-intl";

import { ScrollArea } from "@/components/ui/scroll-area";
import { getDescription } from "@/lib/db/extension/agent";
import { AgentWithRelations } from "@/lib/db/types/agent.types";

import { JobInputsForm } from "./job-input";

interface CreateJobSectionProps {
  agent: AgentWithRelations;
  agentPricing: number;
}

export default function CreateJobSection({
  agent,
  agentPricing,
}: CreateJobSectionProps) {
  const t = useTranslations("App.Agents.Jobs.CreateJob");
  const description = getDescription(agent);

  return (
    <div className="flex h-full min-h-[300px] flex-1 flex-col">
      <ScrollArea className="h-[calc(100%)] rounded-md border p-4">
        <h1 className="h-[30px] text-xl font-bold">{t("title")}</h1>
        <div className="flex flex-1 flex-col gap-4 lg:gap-6">
          <div className="flex flex-wrap gap-2">
            {description && (
              <div className="min-w-[200px] flex-1 text-base">
                {description}
              </div>
            )}
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
          <JobInputsForm agentId={agent.id} agentPricing={agentPricing} />
        </div>
      </ScrollArea>
    </div>
  );
}

import Image from "next/image";
import { useTranslations } from "next-intl";

import Markdown from "@/components/markdown";
import { Accordion } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AgentWithRelations,
  CreditsPrice,
  getAgentDescription,
  getAgentLegal,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";

import AccordionItemWrapper from "./accordion-wrapper";
import { JobInputsForm } from "./job-input";

interface CreateJobSectionProps {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
}

export default function CreateJobSection({
  agent,
  agentCreditsPrice,
}: CreateJobSectionProps) {
  return (
    <div className="flex h-full min-h-[300px] flex-1 flex-col">
      <ScrollArea className="h-full">
        <Accordion
          type="multiple"
          defaultValue={["information", "input"]}
          className="w-full space-y-1.5"
        >
          <InformationAccordionItem agent={agent} />
          <InputAccordionItem
            agent={agent}
            agentCreditsPrice={agentCreditsPrice}
          />
        </Accordion>
      </ScrollArea>
    </div>
  );
}

function InformationAccordionItem({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("App.Agents.Jobs.CreateJob.Information");
  const name = getAgentName(agent);
  const description = getAgentDescription(agent);
  const image = getAgentResolvedImage(agent);

  return (
    <AccordionItemWrapper value="information" title={t("title")}>
      <div className="flex flex-wrap gap-6">
        <div className="h-24 w-24">
          <Image
            src={image}
            alt={name}
            width={96}
            height={96}
            className="rounded-md object-cover"
          />
        </div>
        <div className="flex flex-1 flex-col justify-center gap-0.5">
          <h3 className="text-lg font-bold">{name}</h3>
          {description && <Markdown>{description}</Markdown>}
        </div>
      </div>
    </AccordionItemWrapper>
  );
}

function InputAccordionItem({
  agent,
  agentCreditsPrice,
}: {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
}) {
  const t = useTranslations("App.Agents.Jobs.CreateJob.Input");

  return (
    <AccordionItemWrapper value="input" title={t("title")}>
      <div className="flex flex-col gap-6">
        <p className="text-sm">{t("description")}</p>
        <JobInputsForm
          agentId={agent.id}
          agentCreditsPrice={agentCreditsPrice}
          legal={getAgentLegal(agent)}
        />
      </div>
    </AccordionItemWrapper>
  );
}

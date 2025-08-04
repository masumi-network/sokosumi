"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

import AccordionItemWrapper from "@/app/agents/[agentId]/jobs/components/accordion-wrapper";
import Markdown from "@/components/markdown";
import { Accordion } from "@/components/ui/accordion";
import {
  AgentWithCreditsPrice,
  AgentWithRelations,
  getAgentDescription,
  getAgentLegal,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";

import { useCreateJobModalContext } from "./create-job-modal-context";
import CreateJobModalHeader from "./create-job-modal-header";
import { JobInputsForm } from "./job-input";

interface CreateJobSectionProps {
  agent: AgentWithCreditsPrice;
  averageExecutionDuration: number;
}

export default function CreateJobSection({
  agent,
  averageExecutionDuration,
}: CreateJobSectionProps) {
  const { accordionValue, setAccordionValue, loading } =
    useCreateJobModalContext();

  const handleAccordionValueChange = (value: string[]) => {
    setAccordionValue(value);
  };

  return (
    <div className="bg-background flex min-h-svh w-svw flex-col rounded-none p-4 pt-0 md:min-h-auto md:w-auto md:rounded-xl md:p-6">
      <CreateJobModalHeader agent={agent} />
      <Accordion
        type="multiple"
        value={accordionValue}
        className="w-full space-y-1.5"
        onValueChange={handleAccordionValueChange}
      >
        <InformationAccordionItem agent={agent} disabled={loading} />
        <InputAccordionItem
          agent={agent}
          disabled={loading}
          averageExecutionDuration={averageExecutionDuration}
        />
      </Accordion>
    </div>
  );
}

function InformationAccordionItem({
  agent,
  disabled,
}: {
  agent: AgentWithRelations;
  disabled?: boolean | undefined;
}) {
  const t = useTranslations("App.Agents.Jobs.CreateJob.Information");
  const name = getAgentName(agent);
  const description = getAgentDescription(agent);
  const image = getAgentResolvedImage(agent);

  return (
    <AccordionItemWrapper
      value="information"
      title={t("title")}
      disabled={disabled}
    >
      <div className="flex flex-wrap gap-6">
        <div className="relative h-16 w-16 md:h-24 md:w-24">
          <Image
            src={image}
            alt={name}
            fill
            sizes="(max-width: 768px) 50vw, 33vw"
            className="rounded-md object-cover"
          />
        </div>
        <div className="flex flex-1 flex-col justify-center gap-0.5">
          <h3 className="text-base font-bold md:text-lg">{name}</h3>
          {description && <Markdown>{description}</Markdown>}
        </div>
      </div>
    </AccordionItemWrapper>
  );
}

function InputAccordionItem({
  agent,
  disabled,
  averageExecutionDuration,
}: {
  agent: AgentWithCreditsPrice;
  disabled?: boolean | undefined;
  averageExecutionDuration: number;
}) {
  const t = useTranslations("App.Agents.Jobs.CreateJob.Input");

  return (
    <AccordionItemWrapper value="input" title={t("title")} disabled={disabled}>
      <div className="flex flex-col gap-6">
        <p className="text-sm">{t("description")}</p>
        <JobInputsForm
          agentId={agent.id}
          agentCreditsPrice={agent.creditsPrice}
          legal={getAgentLegal(agent)}
          averageExecutionDuration={averageExecutionDuration}
        />
      </div>
    </AccordionItemWrapper>
  );
}

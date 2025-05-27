"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

import AccordionItemWrapper from "@/app/agents/[agentId]/jobs/components/accordion-wrapper";
import Markdown from "@/components/markdown";
import { Accordion } from "@/components/ui/accordion";
import {
  AgentWithRelations,
  CreditsPrice,
  getAgentDescription,
  getAgentLegal,
  getAgentName,
  getAgentResolvedImage,
} from "@/lib/db";
import { JobInputsDataSchemaType } from "@/lib/job-input";

import { useCreateJobModalContext } from "./create-job-modal-context";
import CreateJobModalHeader from "./create-job-modal-header";
import { JobInputsForm } from "./job-input";

interface CreateJobSectionProps {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
  inputSchemaPromise: Promise<JobInputsDataSchemaType>;
}

export default function CreateJobSection({
  agent,
  agentCreditsPrice,
  inputSchemaPromise,
}: CreateJobSectionProps) {
  const { accordionValue, setAccordionValue, loading } =
    useCreateJobModalContext();

  const handleAccordionValueChange = (value: string[]) => {
    setAccordionValue(value);
  };

  return (
    <div className="bg-background flex flex-col rounded-xl p-6 pt-0">
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
          agentCreditsPrice={agentCreditsPrice}
          inputSchemaPromise={inputSchemaPromise}
          disabled={loading}
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
  inputSchemaPromise,
  disabled,
}: {
  agent: AgentWithRelations;
  agentCreditsPrice: CreditsPrice;
  inputSchemaPromise: Promise<JobInputsDataSchemaType>;
  disabled?: boolean | undefined;
}) {
  const t = useTranslations("App.Agents.Jobs.CreateJob.Input");

  return (
    <AccordionItemWrapper value="input" title={t("title")} disabled={disabled}>
      <div className="flex flex-col gap-6">
        <p className="text-sm">{t("description")}</p>
        <JobInputsForm
          agentId={agent.id}
          agentCreditsPrice={agentCreditsPrice}
          legal={getAgentLegal(agent)}
          inputSchemaPromise={inputSchemaPromise}
        />
      </div>
    </AccordionItemWrapper>
  );
}

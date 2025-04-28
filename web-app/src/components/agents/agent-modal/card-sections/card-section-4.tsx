import Image from "next/image";
import { useTranslations } from "next-intl";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { AgentWithRelations, getAgentExampleOutput } from "@/lib/db";

import { CardSection } from "./card-section";

function CardSection4({ agent }: { agent: AgentWithRelations }) {
  const t = useTranslations("Components.Agents.AgentModal.Card4");
  const exampleOutputs = getAgentExampleOutput(agent);

  if (exampleOutputs.length == 0) {
    return null;
  }

  return (
    <CardSection>
      <div className="w-full">
        <p className="mb-2 text-xs uppercase">{t("title")}</p>
        <ScrollArea className="h-64 w-full">
          <div className="flex h-full gap-2">
            {exampleOutputs.map((exampleOutput) => (
              <div key={exampleOutput.id} className="h-full w-full">
                <div className="relative h-64 w-64">
                  <Image
                    src={exampleOutput.url}
                    alt={exampleOutput.name}
                    fill
                    className="object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </CardSection>
  );
}

export { CardSection4 };

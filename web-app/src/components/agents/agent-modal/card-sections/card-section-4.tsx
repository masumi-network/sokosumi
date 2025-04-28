import Image from "next/image";
import { useTranslations } from "next-intl";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
                    sizes="33vw"
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

function CardSection4Skeleton() {
  return (
    <CardSection>
      <div className="w-full">
        <Skeleton className="mb-2 h-4 w-12" />
        <ScrollArea className="h-64 w-full">
          <div className="flex h-full gap-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-64 w-64" />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </CardSection>
  );
}

export { CardSection4, CardSection4Skeleton };

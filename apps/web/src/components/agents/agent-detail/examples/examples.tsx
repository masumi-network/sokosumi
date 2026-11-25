"use client";

import type { AgentExampleOutput } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

import ExampleDetailThumbnail from "./example-detail-thumbnail";

function AgentDetailExamples({
  exampleOutputs,
}: {
  exampleOutputs: AgentExampleOutput[];
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Examples");

  return (
    <div className="border-border w-full space-y-2 rounded-lg border px-4 py-4">
      <h2 className="text-muted-foreground text-xs font-medium">
        {t("title")}
      </h2>
      <ScrollArea className="h-60 w-full">
        <div className="flex h-full gap-2">
          {exampleOutputs.map((exampleOutput, index) => (
            <div key={`${exampleOutput.url}-${index}`} className="size-full">
              <ExampleDetailThumbnail exampleOutput={exampleOutput} />
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

export { AgentDetailExamples };

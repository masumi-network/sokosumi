"use client";

import { ExampleOutput } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

import ExampleDetailThumbnail from "./example-detail-thumbnail";

function AgentDetailExamples({
  exampleOutputs,
}: {
  exampleOutputs: ExampleOutput[];
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Examples");

  return (
    <div className="w-full">
      <p className="mb-2 text-xs uppercase">{t("title")}</p>
      <ScrollArea className="h-60 w-full">
        <div className="flex h-full gap-2">
          {exampleOutputs.map((exampleOutput) => (
            <div key={exampleOutput.id} className="h-full w-full">
              <ExampleDetailThumbnail exampleOutput={exampleOutput} />
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

function AgentDetailExamplesSkeleton() {
  return (
    <div className="w-full">
      <Skeleton className="mb-2 h-4 w-12" />
      <ScrollArea className="h-60 w-full">
        <div className="flex h-full gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-60 w-60" />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

export { AgentDetailExamples, AgentDetailExamplesSkeleton };

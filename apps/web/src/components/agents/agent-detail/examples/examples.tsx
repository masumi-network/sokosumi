"use client";

import type { ExampleOutput } from "@sokosumi/utils";
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
    <div className="border-border w-full space-y-2 rounded-lg border px-4 py-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">
        {t("title")}
      </h2>
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
    <div className="border-border w-full space-y-2 rounded-lg border px-4 py-4">
      <Skeleton className="h-4 w-12" />
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

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ExampleOutput } from "@/prisma/generated/client";

import ExampleDetailThumbnail from "./example-detail-thumbnail";
import PlaylistModal from "./playlist-modal";

function AgentDetailSection4({
  exampleOutputs,
  agentId,
}: {
  exampleOutputs: ExampleOutput[];
  agentId: string;
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Section4");
  const [open, setOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleThumbnailClick = (index: number) => {
    setOpen(true);
    setCurrentIndex(index);
  };

  return (
    <div className="w-full">
      <p className="mb-2 text-xs uppercase">{t("title")}</p>
      <ScrollArea className="h-60 w-full">
        <div className="flex h-full gap-2">
          {exampleOutputs.map((exampleOutput, index) => (
            <div key={exampleOutput.id} className="h-full w-full">
              <ExampleDetailThumbnail
                exampleOutput={exampleOutput}
                onClick={() => handleThumbnailClick(index)}
              />
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <PlaylistModal
        open={open}
        onClose={() => setOpen(false)}
        exampleOutputs={exampleOutputs}
        agentId={agentId}
        initialIndex={currentIndex}
      />
    </div>
  );
}

function AgentDetailSection4Skeleton() {
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

export { AgentDetailSection4, AgentDetailSection4Skeleton };

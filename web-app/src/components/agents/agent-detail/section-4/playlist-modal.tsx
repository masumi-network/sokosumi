"use client";

import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { AgentHireButton } from "@/components/agents/agent-hire-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ExampleOutput } from "@/prisma/generated/client";

import ExampleDetailThumbnail from "./example-detail-thumbnail";

interface PlaylistModalProps {
  open: boolean;
  onClose: () => void;
  exampleOutputs: ExampleOutput[];
  agentId: string;
  initialIndex?: number | undefined;
}

export default function PlaylistModal({
  open,
  onClose,
  exampleOutputs,
  agentId,
  initialIndex,
}: PlaylistModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex ?? 0);

  useEffect(() => {
    if (initialIndex) {
      setCurrentIndex(initialIndex);
    }
  }, [initialIndex]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const handlePlaylistClick = (index: number) => {
    setCurrentIndex(index);
  };

  const selectedExampleOutput = exampleOutputs[currentIndex];

  if (exampleOutputs.length === 0 || !selectedExampleOutput) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay className="backdrop-blur-lg" />
        <DialogContent className="w-[80vw] max-w-full! min-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none [&>button]:hidden">
          <DialogTitle className="hidden" />
          <DialogDescription className="hidden" />
          <div className="flex h-[90svh] w-full">
            <PlaylistSidebar
              exampleOutputs={exampleOutputs}
              currentIndex={currentIndex}
              onClick={handlePlaylistClick}
            />
            <PlaylistMainSection
              selectedExampleOutput={selectedExampleOutput}
              agentId={agentId}
              onClose={onClose}
            />
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function PlaylistSidebar({
  exampleOutputs,
  currentIndex,
  onClick,
}: {
  exampleOutputs: ExampleOutput[];
  currentIndex: number;
  onClick: (index: number) => void;
}) {
  return (
    <ScrollArea className="bg-muted h-full rounded-l-xl">
      <div className="flex w-full flex-col gap-1.5 p-3 pr-6">
        {exampleOutputs.map((exampleOutput, index) => (
          <ExampleDetailThumbnail
            key={exampleOutput.id}
            exampleOutput={exampleOutput}
            className={cn("h-24 w-24 cursor-pointer p-2", {
              "border-primary border-2": currentIndex === index,
            })}
            onClick={() => onClick(index)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function PlaylistMainSection({
  selectedExampleOutput,
  agentId,
  onClose,
}: {
  selectedExampleOutput: ExampleOutput;
  agentId: string;
  onClose: () => void;
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Section4");

  return (
    <div className="bg-background flex-1 rounded-r-xl">
      <div className="flex items-center justify-between px-6 py-3">
        <p className="text-foreground text-lg font-medium">
          {selectedExampleOutput.name}
        </p>
        <div className="flex items-center gap-1">
          <AgentHireButton agentId={agentId} size="default" />
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-6 p-6">
        <ExampleDetailThumbnail exampleOutput={selectedExampleOutput} />
        <Button variant="primary" asChild>
          <a
            href={selectedExampleOutput.url}
            download
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download />
            {t("download")}
          </a>
        </Button>
      </div>
    </div>
  );
}

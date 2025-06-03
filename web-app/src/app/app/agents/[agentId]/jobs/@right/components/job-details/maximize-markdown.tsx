"use client";

import { Maximize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface MaximizeMarkdownProps {
  markdown: string;
  className?: string;
}

export default function MaximizeMarkdown({
  markdown,
  className,
}: MaximizeMarkdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output");

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className={cn("text-muted-foreground", className)}
        title={t("maximize")}
      >
        <Maximize2 className="h-4 w-4" />
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="flex max-h-[90vh] !max-w-[95vw] flex-col overflow-y-auto sm:!max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>{t("maximizeTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex-grow overflow-y-auto py-2">
            <Markdown>{markdown}</Markdown>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("close")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

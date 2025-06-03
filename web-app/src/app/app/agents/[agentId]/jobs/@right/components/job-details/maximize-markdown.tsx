import { Maximize2 } from "lucide-react";
import { useTranslations } from "next-intl";

import Markdown from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  const t = useTranslations("App.Agents.Jobs.JobDetails.Output");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground", className)}
          title={t("maximize")}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex h-fit max-h-[90vh] w-fit max-w-[80vw] flex-col overflow-y-auto sm:max-w-[90vw]"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{t("maximizeTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex-grow overflow-y-auto py-2">
          <Markdown>{markdown}</Markdown>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" type="button">
              {t("close")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

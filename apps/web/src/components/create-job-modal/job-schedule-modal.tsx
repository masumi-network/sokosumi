"use client";

import { JobScheduleSection } from "@/components/create-job-modal/job-schedule-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobScheduleSelectionType } from "@/lib/db/types/job";

interface JobScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezoneOptions: string[];
  selection?: JobScheduleSelectionType | null;
  onSave: (selection: JobScheduleSelectionType) => void;
  onCancel: () => void;
  disableOutsideClose?: boolean;
}

export function JobScheduleModal({
  open,
  onOpenChange,
  timezoneOptions,
  selection,
  onSave,
  onCancel,
}: JobScheduleModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-svw max-w-lg! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <div className="bg-background min-h-svh w-svw space-y-4 rounded-none p-4 md:min-h-auto md:w-lg md:rounded-xl md:p-8">
            <JobScheduleSection
              timezoneOptions={timezoneOptions}
              initialSelection={selection ?? undefined}
              onSave={onSave}
              onCancel={onCancel}
            />
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

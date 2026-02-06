"use client";

import { TaskStatus } from "@sokosumi/database";
import { Check, Command, CornerDownLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOSDetection } from "@/hooks/use-os-detection";
import { createTask } from "@/lib/actions/task/action";
import { cn } from "@/lib/utils";
import type { CoworkerOption } from "@/lib/types/coworker";

import { MarkdownEditor } from "./markdown-editor";

// --- Context ---

interface CreateTaskModalContextType {
  open: boolean;
  handleOpen: () => void;
  handleClose: () => void;
}

const CreateTaskModalContext = createContext<CreateTaskModalContextType>({
  open: false,
  handleOpen: () => {},
  handleClose: () => {},
});

export function useCreateTaskModal() {
  return useContext(CreateTaskModalContext);
}

export function CreateTaskModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <CreateTaskModalContext.Provider value={{ open, handleOpen, handleClose }}>
      {children}
    </CreateTaskModalContext.Provider>
  );
}

// --- Coworker Card ---

function CoworkerCard({
  option,
  isSelected,
  onSelect,
}: {
  option: CoworkerOption;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-all",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-transparent bg-muted/40 hover:bg-muted/70",
      )}
    >
      {isSelected && (
        <div className="bg-primary absolute top-2 right-2 flex size-5 items-center justify-center rounded-full">
          <Check className="size-3 text-white" />
        </div>
      )}
      <Avatar className="size-10 shrink-0 rounded-lg">
        <AvatarImage src={option.image} alt={option.name} className="object-cover" />
        <AvatarFallback className="rounded-lg text-xs">
          {option.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{option.name}</p>
        {option.description ? (
          <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
            {option.description}
          </p>
        ) : null}
      </div>
    </button>
  );
}

// --- Modal ---

interface CreateTaskModalProps {
  coworkerOptions: CoworkerOption[];
}

export function CreateTaskModal({
  coworkerOptions,
}: CreateTaskModalProps) {
  const { open, handleClose } = useCreateTaskModal();
  const router = useRouter();
  const t = useTranslations("App.Tasks.NewTask");
  const { os, isMobile } = useOSDetection();

  const [description, setDescription] = useState("");
  const [coworkerId, setCoworkerId] = useState<string>(
    coworkerOptions[0]?.id ?? "",
  );
  const [submittingAs, setSubmittingAs] = useState<"draft" | "create" | null>(null);

  useEffect(() => {
    if (open) {
      setDescription("");
      setCoworkerId(coworkerOptions[0]?.id ?? "");
    }
  }, [open, coworkerOptions]);

  const isSubmitting = submittingAs !== null;
  const isSaveDisabled = !description.trim() || isSubmitting;

  const handleSubmit = useCallback(
    async (status: TaskStatus, buttonType: "draft" | "create") => {
      if (!description.trim() || isSubmitting) return;
      setSubmittingAs(buttonType);
      try {
        const result = await createTask({
          description: description.trim(),
          coworkerId,
          status,
        });
        handleClose();
        router.push(`/tasks/${result.taskId}`);
      } catch (error) {
        console.error("Failed to create task", error);
        toast.error("Failed to create task");
      } finally {
        setSubmittingAs(null);
      }
    },
    [description, isSubmitting, coworkerId, handleClose, router],
  );

  const handleCreateTask = useCallback(
    () => handleSubmit(TaskStatus.READY, "create"),
    [handleSubmit],
  );

  const handleSaveAsDraft = useCallback(
    () => handleSubmit(TaskStatus.DRAFT, "draft"),
    [handleSubmit],
  );

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const isSubmitKey =
        event.key === "Enter" && (event.metaKey || event.ctrlKey);
      if (!isSubmitKey) return;
      event.preventDefault();
      handleCreateTask();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleCreateTask]);

  const handleOnOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    if (!nextOpen) handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOnOpenChange}>
      <DialogContent className="w-svw max-w-3xl! border-none bg-transparent p-0 focus:ring-0 focus:outline-none md:w-[80vw] [&>button]:hidden">
        <DialogTitle className="hidden" />
        <DialogDescription className="hidden" />
        <ScrollArea className="max-h-svh md:max-h-[90svh]">
          <div className="bg-background flex min-h-svh w-svw flex-col rounded-none md:min-h-auto md:w-auto md:rounded-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4">
              <div className="w-16" />
              <h3 className="text-base font-semibold">{t("title")}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                <span className="text-primary text-sm">{t("cancel")}</span>
              </Button>
            </div>

            <div className="border-t" />

            {/* Task Description */}
            <div className="space-y-2 px-6 py-5">
              <Label htmlFor="modal-task-description" className="text-sm font-medium">
                {t("details")}
              </Label>
              <MarkdownEditor
                id="modal-task-description"
                placeholder={t("descriptionPlaceholder")}
                value={description}
                onChange={setDescription}
              />
            </div>

            <div className="border-t" />

            {/* Coworker Selection */}
            <div className="space-y-3 px-6 py-5">
              <Label className="text-sm font-medium">
                {t("coworker")}
              </Label>
              <div className={cn(
                "max-h-[264px] overflow-y-auto pr-1",
              )}>
                <div className="grid grid-cols-2 gap-2">
                  {coworkerOptions.map((option) => (
                    <CoworkerCard
                      key={option.id}
                      option={option}
                      isSelected={coworkerId === option.id}
                      onSelect={() => setCoworkerId(option.id)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t" />

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={isSaveDisabled}
                onClick={handleSaveAsDraft}
              >
                {submittingAs === "draft" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {t("saveAsDraft")}
              </Button>
              <Button
                type="button"
                disabled={isSaveDisabled}
                onClick={handleCreateTask}
              >
                <div className="flex items-center gap-1.5">
                  {submittingAs === "create" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {t("createTask")}
                  {!isMobile ? (
                    <div className="flex items-center gap-0.5 opacity-60">
                      {os === "MacOS" ? (
                        <Command className="size-3" />
                      ) : (
                        <span className="text-xs">{t("ctrl")}</span>
                      )}
                      <CornerDownLeft className="size-3" />
                    </div>
                  ) : null}
                </div>
              </Button>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

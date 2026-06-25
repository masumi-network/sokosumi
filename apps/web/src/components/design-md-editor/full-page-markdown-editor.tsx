"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { MarkdownEditor } from "@/app/tasks/components/markdown-editor";
import Markdown from "@/components/markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

export interface FullPageMarkdownEditorLabels {
  cancel: string;
  discardConfirm: string;
  discardDialogDescription: string;
  discardDialogTitle: string;
  editTab: string;
  previewTab: string;
  save: string;
  saving: string;
  title: string;
}

interface FullPageMarkdownEditorProps {
  className?: string;
  initialValue: string;
  isSaving: boolean;
  labels: FullPageMarkdownEditorLabels;
  onCancel: () => void;
  onSave: () => void;
  onValueChange: (value: string) => void;
  value: string;
}

export function FullPageMarkdownEditor({
  className,
  initialValue,
  isSaving,
  labels,
  onCancel,
  onSave,
  onValueChange,
  value,
}: FullPageMarkdownEditorProps) {
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);
  const isDirty = value !== initialValue;
  const isEmpty = value.trim().length === 0;
  const canSave = isDirty && !isEmpty && !isSaving;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useMountEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  });

  const handleCancelClick = useCallback(() => {
    if (isDirty) {
      setIsDiscardDialogOpen(true);
      return;
    }

    onCancel();
  }, [isDirty, onCancel]);

  const handleDiscardConfirm = useCallback(() => {
    setIsDiscardDialogOpen(false);
    onCancel();
  }, [onCancel]);

  return (
    <>
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <header className="border-b px-4 py-4 sm:px-6">
          <h1 className="font-semibold text-lg tracking-tight sm:text-xl">
            {labels.title}
          </h1>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-2 lg:divide-x">
            <div className="flex min-h-0 flex-col overflow-hidden p-4 sm:p-6">
              <MarkdownEditor
                value={value}
                onChange={onValueChange}
                className="flex h-full min-h-0 flex-col"
                editorClassName="max-h-none min-h-0 flex-1"
              />
            </div>
            <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
              <Markdown>{value}</Markdown>
            </div>
          </div>

          <Tabs
            defaultValue="edit"
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-4 sm:px-6 lg:hidden"
          >
            <TabsList className="bg-muted/50 w-full">
              <TabsTrigger value="edit" className="flex-1">
                {labels.editTab}
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex-1">
                {labels.previewTab}
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="edit"
              className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <MarkdownEditor
                value={value}
                onChange={onValueChange}
                className="flex h-full min-h-0 flex-col"
                editorClassName="max-h-none min-h-0 flex-1"
              />
            </TabsContent>
            <TabsContent
              value="preview"
              className="mt-0 min-h-0 flex-1 overflow-y-auto"
            >
              <Markdown>{value}</Markdown>
            </TabsContent>
          </Tabs>
        </div>

        <footer className="sticky bottom-0 border-t bg-background px-4 py-4 sm:px-6">
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={handleCancelClick}
            >
              {labels.cancel}
            </Button>
            <Button type="button" disabled={!canSave} onClick={onSave}>
              {isSaving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              {isSaving ? labels.saving : labels.save}
            </Button>
          </div>
        </footer>
      </div>

      <AlertDialog
        open={isDiscardDialogOpen}
        onOpenChange={setIsDiscardDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.discardDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.discardDialogDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>
              {labels.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSaving}
              onClick={handleDiscardConfirm}
            >
              {labels.discardConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

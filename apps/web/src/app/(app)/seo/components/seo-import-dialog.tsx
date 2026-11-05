"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { useSeoImport } from "./use-seo-import";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoImportDialog({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const form = useSeoImport(model);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>{t("import.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <SeoField id="seo-import-search" label={t("search")}>
            <Input
              id="seo-import-search"
              type="search"
              value={form.search}
              onChange={(event) => form.changeSearch(event.target.value)}
              placeholder={t("import.searchPlaceholder")}
            />
          </SeoField>
          {form.candidates.isPending ? (
            <p role="status">{t("loading")}</p>
          ) : form.candidates.isError ? (
            <div role="alert">
              <p>{t("import.failed")}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void form.candidates.refetch();
                }}
              >
                {t("retry")}
              </Button>
            </div>
          ) : form.tasks.length ? (
            <SeoField id="seo-import-task" label={t("import.task")}>
              <SeoSelect
                id="seo-import-task"
                value={form.taskId}
                onValueChange={form.selectTask}
                required
                placeholder={t("import.chooseTask")}
                options={form.tasks.map((task) => ({
                  value: task.id,
                  label: task.name,
                }))}
              />
            </SeoField>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("import.noTasks")}
            </p>
          )}
          {form.candidates.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              disabled={form.candidates.isFetchingNextPage}
              onClick={() => {
                void form.candidates.fetchNextPage();
              }}
            >
              {t("more")}
            </Button>
          ) : null}
          {form.taskId ? (
            form.selectedTask.isPending ? (
              <p role="status">{t("loading")}</p>
            ) : form.selectedTask.isError ? (
              <p role="alert">{t("import.failed")}</p>
            ) : form.files.length ? (
              <SeoField id="seo-import-file" label={t("import.file")}>
                <SeoSelect
                  id="seo-import-file"
                  value={form.fileId}
                  onValueChange={form.setFileId}
                  required
                  placeholder={t("import.chooseFile")}
                  options={form.files.map((file) => ({
                    value: file.id,
                    label: file.name,
                  }))}
                />
              </SeoField>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("import.noFiles")}
              </p>
            )
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={model.pending}
              onClick={() => model.setDialog(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                model.pending ||
                !form.fileId ||
                !model.data.availableActions.canEdit
              }
            >
              {t("import.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

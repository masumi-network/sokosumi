"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { isAgentOnlyTaskStatus } from "@sokosumi/utils";
import {
  CalendarClock,
  Command,
  CornerDownLeft,
  Loader2,
  Paperclip,
} from "lucide-react";
import { useRef, useState } from "react";
import { TableAttachDialog } from "@/app/drive/tables/table-attach-dialog";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { AttachmentSubmenu } from "@/components/drive/attachment-submenu";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSession } from "@/lib/auth/auth.client";
import { MarkdownEditor } from "./markdown-editor";
import { TaskAssigneePicker } from "./task-assignee-picker";
import { TaskComposer } from "./task-composer";
import { TaskContextAttachmentsField } from "./task-context-attachments";
import { TaskCreatedCelebration } from "./task-created-celebration";
import { TaskDraftTags } from "./task-draft-tags";
import type { TaskFormProps } from "./task-form-types";
import { TaskProjectSelect } from "./task-project-select";
import { TaskRunAtModal } from "./task-run-at-modal";
import { TaskStatusPicker } from "./task-status-picker";
import { TaskTagCatalogProvider } from "./task-tag-catalog";
import { TaskWorkspaceTagPicker } from "./task-workspace-tag-picker";

export type {
  TaskFormCreateHandler,
  TaskFormCreateInput,
  TaskFormInitialDesignMdAttachment,
  TaskFormLabels,
} from "./task-form-types";

import { useTaskFormModel } from "./use-task-form-model";
import { useTaskFormSubmission } from "./use-task-form-submission";

export function TaskForm(props: TaskFormProps) {
  const { data: session } = useSession();
  return (
    <TaskTagCatalogProvider
      enabled={Boolean(session)}
      organizationId={session?.session.activeOrganizationId ?? null}
    >
      <TaskFormContent props={props} session={session} />
    </TaskTagCatalogProvider>
  );
}

function TaskFormContent({
  props,
  session,
}: {
  props: TaskFormProps;
  session: ReturnType<typeof useSession>["data"];
}) {
  const model = useTaskFormModel(props, session);
  const handleSave = useTaskFormSubmission(model);
  const { createdTask, labels, onCreateAnother, handleGoToTask } = model;

  if (createdTask) {
    return (
      <TaskCreatedCelebration
        name={createdTask.name}
        status={createdTask.status}
        statusLabel={createdTask.statusLabel}
        scheduleLabel={createdTask.scheduleLabel}
        labels={{
          taskCreated: labels.taskCreated ?? "Task created",
          taskCreatedHint: labels.taskCreatedHint,
          goToTask: labels.goToTask ?? "Bring me to the task",
          createAnother: labels.createAnother,
        }}
        onGoToTask={handleGoToTask}
        onCreateAnother={onCreateAnother}
      />
    );
  }

  if (model.mode === "create") {
    return (
      <TaskComposer
        model={model}
        session={session}
        onSave={() => {
          void handleSave();
        }}
      />
    );
  }

  return <TaskEditForm model={model} onSave={() => void handleSave()} />;
}

function TaskEditForm({
  model,
  onSave,
}: {
  model: ReturnType<typeof useTaskFormModel>;
  onSave: () => void;
}) {
  const [isTablePickerOpen, setIsTablePickerOpen] = useState(false);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const {
    taskId,
    labels,
    initialDesignMdAttachment,
    showCancel,
    tRunAt,
    shouldShowProjectSelect,
    workspaceSelection,
    setIsCreatingTag,
    name,
    setName,
    projectId,
    isProjectMissing,
    projectSelectRef,
    projectErrorId,
    contextSelection,
    setContextSelection,
    description,
    setDescription,
    localProjectOptions,
    isCreateProjectModalOpen,
    setIsCreateProjectModalOpen,
    createProjectQuery,
    assigneeId,
    runAt,
    status,
    isRunAtModalOpen,
    setIsRunAtModalOpen,
    isSubmitting,
    pendingUploadFiles,
    setPendingUploadFiles,
    markdownEditorRef,
    attachmentTriggerRef,
    attachmentUrls,
    handleAttachFiles,
    handleRemoveAttachment,
    mentionOptions,
    handleCoworkerSelect,
    handleStatusSelect,
    handleCreateProject,
    handleProjectChange,
    handleProjectCreated,
    os,
    isMobile,
    selectedProject,
    isUploadingAttachments,
    hasRunAt,
    runAtLabel,
    isSaveDisabled,
    statusPickerLabels,
    draftTags,
    isAgentAssignee,
    isQueuedSelectable,
    statusOptions,
    availableAssigneeOptions,
    isAssigneeLockedToAgent,
    session,
    handleCancel,
    handleRunAtApply,
    handleRunAtClear,
  } = model;
  const attachDisabled = isSubmitting || isUploadingAttachments;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="app-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="px-6 py-4 md:px-8">
            <TaskAssigneePicker
              value={assigneeId}
              options={availableAssigneeOptions}
              labels={{
                ariaLabel: labels.coworker,
                unassigned: labels.unassigned,
                unavailableAssignee: labels.unavailableAssignee,
                searchPlaceholder: labels.changeCoworker,
                noResults: labels.noCoworkerMatches,
                agentsGroupLabel: labels.coworker,
              }}
              onSelect={handleCoworkerSelect}
              isOptionDisabled={(option) =>
                option === "unassigned" ? isAssigneeLockedToAgent : false
              }
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 border-t px-6 py-5 md:px-8">
            {/* A textarea that grows, so a long title wraps on a phone instead of being cut off. */}
            <textarea
              id="task-name"
              rows={1}
              aria-label={labels.name}
              placeholder={labels.namePlaceholder}
              value={name}
              onChange={(event) =>
                setName(event.target.value.replace(/\r?\n/g, " "))
              }
              onKeyDown={(event) => {
                // A title is one line; Cmd/Ctrl+Enter still saves.
                if (
                  event.key === "Enter" &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                }
              }}
              className="block w-full field-sizing-content resize-none border-0 bg-transparent p-0 text-xl leading-tight font-semibold tracking-tight outline-none shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            />

            {/* Never shorter than the editor's own minimum: on a phone the
            column ran out of room, squeezed this box and drew the attachment
            chips over the brief. */}
            <div className="flex flex-1 flex-col">
              <FileUpload
                className="min-h-32 flex-1"
                value={pendingUploadFiles}
                onValueChange={setPendingUploadFiles}
                onAccept={(files) => {
                  void handleAttachFiles(files);
                }}
                multiple
              >
                <FileUploadDropzone
                  noClick
                  className="data-dragging:bg-card-background min-h-0 w-full flex-1 items-stretch justify-start border-0 p-0 hover:bg-transparent"
                >
                  <MarkdownEditor
                    ref={markdownEditorRef}
                    id="task-description"
                    variant="document"
                    ariaLabel={labels.details}
                    placeholder={labels.descriptionPlaceholder}
                    className="flex min-h-0 w-full flex-1 flex-col"
                    editorClassName="max-h-none flex-1"
                    value={description}
                    onChange={setDescription}
                    onSubmitShortcut={onSave}
                    mentions={mentionOptions}
                  />
                  <FileUploadTrigger asChild>
                    <button
                      ref={attachmentTriggerRef}
                      type="button"
                      className="sr-only"
                      aria-label={labels.uploadFile}
                    >
                      {labels.uploadFile}
                    </button>
                  </FileUploadTrigger>
                </FileUploadDropzone>
              </FileUpload>
              {attachmentUrls.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {attachmentUrls.map((url) => (
                    <FileChipMiniPreviewWithMetadata
                      key={url}
                      url={url}
                      sizeClass="size-16"
                      onRemove={() => handleRemoveAttachment(url)}
                      removeLabel={labels.removeAttachment}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            {session ? (
              <TaskWorkspaceTagPicker
                key={session.session.activeOrganizationId ?? session.user.id}
                activeOrganizationId={
                  session.session.activeOrganizationId ?? null
                }
                selected={workspaceSelection.workspaceTags}
                suggestions={workspaceSelection.suggestions}
                onChange={workspaceSelection.setWorkspaceTags}
                onCreatingChange={setIsCreatingTag}
                disabled={isSubmitting || workspaceSelection.hasConflict}
                conflict={
                  taskId && workspaceSelection.hasConflict
                    ? {
                        taskId,
                        onReload: ({ workspaceTags, tags }) =>
                          workspaceSelection.reload(workspaceTags, tags),
                      }
                    : undefined
                }
              >
                <TaskDraftTags
                  tags={workspaceSelection.visibleTopics}
                  status={draftTags.status}
                  onRemove={workspaceSelection.removeTopic}
                  disabled={isSubmitting || workspaceSelection.hasConflict}
                />
              </TaskWorkspaceTagPicker>
            ) : null}

            {shouldShowProjectSelect ? (
              <div className="space-y-1">
                <div
                  data-testid="task-compose-meta-row"
                  className="flex flex-wrap items-center gap-2"
                >
                  <TaskProjectSelect
                    ref={projectSelectRef}
                    variant="chip"
                    projectOptions={localProjectOptions}
                    value={projectId}
                    onChange={handleProjectChange}
                    projectLabel={labels.projectLabel}
                    noneLabel={labels.projectNone}
                    placeholder={labels.projectPlaceholder}
                    searchPlaceholder={labels.projectSearchPlaceholder}
                    emptyResults={labels.projectEmptyResults}
                    projectCreate={labels.projectCreate}
                    projectCreateNamed={labels.projectCreateNamed}
                    onCreateProject={handleCreateProject}
                    invalid={isProjectMissing}
                    describedBy={
                      isProjectMissing && labels.projectRequired
                        ? projectErrorId
                        : undefined
                    }
                  />
                </div>
                {isProjectMissing && labels.projectRequired ? (
                  <p id={projectErrorId} className="text-destructive text-xs">
                    {labels.projectRequired}
                  </p>
                ) : null}
              </div>
            ) : null}
            <TaskContextAttachmentsField
              layout="inline"
              defaultBrand={initialDesignMdAttachment ?? null}
              project={selectedProject}
              selection={contextSelection}
              onSelectionChange={setContextSelection}
            />
          </div>
        </div>

        {isRunAtModalOpen ? (
          <TaskRunAtModal
            runAt={runAt}
            onApply={handleRunAtApply}
            onClear={handleRunAtClear}
            onClose={() => setIsRunAtModalOpen(false)}
          />
        ) : null}

        {shouldShowProjectSelect ? (
          <InlineCreateProjectModal
            open={isCreateProjectModalOpen}
            onOpenChange={setIsCreateProjectModalOpen}
            initialName={createProjectQuery}
            onCreated={handleProjectCreated}
          />
        ) : null}

        <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t px-6 py-3 sm:flex-row sm:items-center md:px-8">
          <div className="app-scrollbar -m-1.5 flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto p-1.5">
            <AttachmentSubmenu
              onUploadClick={() => attachmentTriggerRef.current?.click()}
              onDriveClick={() => markdownEditorRef.current?.openDrivePicker()}
              onTableClick={() => setIsTablePickerOpen(true)}
              disabled={attachDisabled}
            >
              <button
                ref={attachButtonRef}
                type="button"
                aria-label={labels.uploadFile}
                disabled={attachDisabled}
                className="focus-visible:ring-ring text-muted-foreground press hover:bg-accent hover:text-accent-foreground hit-area inline-flex size-7 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {isUploadingAttachments ? (
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-pulse"
                    aria-hidden
                  />
                ) : (
                  <Paperclip className="size-3.5" aria-hidden />
                )}
              </button>
            </AttachmentSubmenu>
            {isTablePickerOpen && (
              <TableAttachDialog
                onClose={() => setIsTablePickerOpen(false)}
                onPick={(file) => void handleAttachFiles([file])}
                returnFocusRef={attachButtonRef}
              />
            )}
            <TaskStatusPicker
              value={status}
              options={statusOptions}
              labels={{
                statusLabels: statusPickerLabels,
                ariaLabel: labels.status,
                searchPlaceholder: labels.changeStatus,
                noResults: labels.noStatusMatches,
              }}
              onSelect={handleStatusSelect}
              isOptionDisabled={(option) =>
                (isAgentOnlyTaskStatus(option) && !isAgentAssignee) ||
                (option === TaskStatus.QUEUED && !isQueuedSelectable)
              }
              align="start"
            />
            {runAtLabel ? (
              <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
                <CalendarClock className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{runAtLabel}</span>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 sm:ml-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-disabled={!isAgentAssignee}
                  aria-label={labels.openRunAt}
                  aria-pressed={hasRunAt}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-background aria-disabled:hover:text-foreground"
                  onClick={() => {
                    if (isAgentAssignee) setIsRunAtModalOpen(true);
                  }}
                >
                  <CalendarClock className="size-4" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="max-w-64">
                {isAgentAssignee ? labels.openRunAt : tRunAt("requiresAgent")}
              </TooltipContent>
            </Tooltip>
            <Button
              type="button"
              className="min-w-28 items-center justify-between gap-1"
              disabled={isSaveDisabled}
              loading={isSubmitting}
              onClick={onSave}
            >
              <div className="flex items-center gap-2">
                {labels.submit}
                {!isMobile ? (
                  <div className="flex items-center gap-1">
                    {os === "MacOS" ? <Command /> : labels.ctrl}
                    <CornerDownLeft />
                  </div>
                ) : null}
              </div>
            </Button>
            {showCancel ? (
              <Button
                type="button"
                variant="outline"
                className="min-w-24"
                onClick={handleCancel}
              >
                {labels.cancel}
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { isAgentOnlyTaskStatus } from "@sokosumi/utils";
import {
  ChevronRight,
  Command,
  CornerDownLeft,
  Loader2,
  Paperclip,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { TableAttachDialog } from "@/app/drive/tables/table-attach-dialog";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { isOtherHumanAssignee } from "@/app/tasks/utils/coworker-options";
import { AttachmentSubmenu } from "@/components/drive/attachment-submenu";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Switch } from "@/components/ui/switch";
import { useFocusWhen } from "@/hooks/effects/use-focus-when";
import type { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { MarkdownEditor } from "./markdown-editor";
import { SimilarTasksHint } from "./similar-tasks-hint";
import { TaskAssigneePicker } from "./task-assignee-picker";
import {
  DueDatePill,
  PriorityPill,
  PrivatePill,
  StartTimePill,
  TemplatePill,
} from "./task-composer-pills";
import { TaskContextAttachmentsField } from "./task-context-attachments";
import { TaskCreateProgress } from "./task-create-progress";
import { TaskDraftTags } from "./task-draft-tags";
import { TaskFormModalHeaderStart } from "./task-form-modal";
import { TaskProjectSelect } from "./task-project-select";
import { TaskRunAtModal } from "./task-run-at-modal";
import { TaskStatusPicker } from "./task-status-picker";
import { TaskWorkspaceTagPicker } from "./task-workspace-tag-picker";
import type { useTaskFormModel } from "./use-task-form-model";

type TaskFormModel = ReturnType<typeof useTaskFormModel>;

/**
 * The New Task composer: the text is the hero (a borderless title and
 * description), every property is one quiet pill under it, and the footer
 * holds attachments on the left and the create action on the right.
 */
export function TaskComposer({
  model,
  session,
  onSave,
}: {
  model: TaskFormModel;
  session: ReturnType<typeof useSession>["data"];
  onSave: () => void;
}) {
  const t = useTranslations("App.Tasks.Composer");
  const tRunAt = useTranslations("App.Tasks.RunAt");
  const createMoreId = useId();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const [isTablePickerOpen, setIsTablePickerOpen] = useState(false);
  const {
    labels,
    initialValues,
    initialDesignMdAttachment,
    shouldShowProjectSelect,
    isCopy,
    workspaceSelection,
    setIsCreatingTag,
    name,
    setName,
    isPrivate,
    setIsPrivate,
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
    priority,
    setPriority,
    dueOn,
    setDueOn,
    createMore,
    setCreateMore,
    isRunAtModalOpen,
    setIsRunAtModalOpen,
    isSubmitting,
    submittedTagReceipt,
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
    selectedOption,
    isAgentAssignee,
    isQueuedSelectable,
    statusOptions,
    blocksOtherPeople,
    showPrivateControl,
    availableAssigneeOptions,
    isAssigneeLockedToAgent,
    handleRunAtApply,
    handleRunAtClear,
    composeKey,
  } = model;

  // Deferred a frame so it lands after the dialog's own first focus.
  useFocusWhen(titleRef, true, { deferToFrame: true, resetKey: composeKey });

  const attachDisabled = isSubmitting || isUploadingAttachments;
  const submitLabel = hasRunAt
    ? (labels.scheduleTask ?? labels.createTask ?? labels.submit)
    : (labels.createTask ?? labels.submit);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {shouldShowProjectSelect ? (
        <TaskFormModalHeaderStart inlineOutsideModal>
          <span className="flex min-w-0 items-center gap-1">
            <TaskProjectSelect
              ref={projectSelectRef}
              variant="crumb"
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
            <ChevronRight
              className="text-muted-foreground size-3.5 shrink-0"
              aria-hidden
            />
          </span>
        </TaskFormModalHeaderStart>
      ) : null}

      <div className="app-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-1 pb-3 md:px-6">
        <textarea
          ref={titleRef}
          id="task-name"
          rows={1}
          aria-label={labels.name}
          placeholder={t("titlePlaceholder")}
          value={name}
          onChange={(event) =>
            setName(event.target.value.replace(/\r?\n/g, " "))
          }
          onKeyDown={(event) => {
            // One line: Enter moves on to the description; Cmd/Ctrl+Enter saves.
            if (
              event.key === "Enter" &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              markdownEditorRef.current?.focus();
            }
          }}
          className="placeholder:text-muted-foreground block w-full field-sizing-content resize-none rounded-sm border-0 bg-transparent p-0 text-xl leading-snug font-semibold tracking-tight shadow-none outline-none focus-visible:outline-none"
        />

        <FileUpload
          className="mt-2 flex min-h-24 flex-1 flex-col"
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
              key={composeKey}
              ref={markdownEditorRef}
              id="task-description"
              variant="document"
              ariaLabel={labels.details}
              placeholder={t("descriptionPlaceholder")}
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
                tabIndex={-1}
              >
                {labels.uploadFile}
              </button>
            </FileUploadTrigger>
          </FileUploadDropzone>
        </FileUpload>

        {attachmentUrls.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
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

        {session && !isCopy ? (
          <div className="mt-2">
            <SimilarTasksHint
              brief={description}
              activeOrganizationId={
                session.session.activeOrganizationId ?? null
              }
            />
          </div>
        ) : null}
      </div>

      <div className="shrink-0 px-5 pb-3 md:px-6">
        <div
          role="group"
          aria-label={t("properties")}
          data-testid="task-compose-meta-row"
          className="app-scrollbar -mx-5 flex items-center gap-1.5 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
        >
          <TaskStatusPicker
            variant="composer"
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
          <TaskAssigneePicker
            variant="pill"
            value={assigneeId}
            options={availableAssigneeOptions}
            labels={{
              ariaLabel: t("assignee"),
              unassigned: labels.unassigned,
              unavailableAssignee: labels.unavailableAssignee,
              searchPlaceholder: t("assignTo"),
              noResults: labels.noCoworkerMatches,
              agentsGroupLabel: t("agents"),
            }}
            onSelect={handleCoworkerSelect}
            isOptionDisabled={(option) =>
              option === "unassigned"
                ? isAssigneeLockedToAgent
                : blocksOtherPeople &&
                  option.kind === "user" &&
                  isOtherHumanAssignee(option.id, session?.user.id)
            }
          />
          <PriorityPill value={priority} onChange={setPriority} />
          <DueDatePill value={dueOn} onChange={setDueOn} />
          <StartTimePill
            label={labels.openRunAt}
            shownTime={runAtLabel}
            enabled={isAgentAssignee}
            disabledHint={tRunAt("requiresAgent")}
            onOpen={() => setIsRunAtModalOpen(true)}
          />
          {session &&
          (!isCopy || initialValues?.workspaceTags || initialValues?.tags) ? (
            <TaskWorkspaceTagPicker
              key={session.session.activeOrganizationId ?? session.user.id}
              variant="pill"
              activeOrganizationId={
                session.session.activeOrganizationId ?? null
              }
              canChooseWorkspaceTags={
                !isCopy || initialValues?.workspaceTags !== undefined
              }
              copying={isCopy && Boolean(initialValues?.workspaceTags?.length)}
              liveAutomaticIds={
                isCopy ? undefined : workspaceSelection.liveAutomaticIds
              }
              selected={workspaceSelection.workspaceTags}
              suggestions={workspaceSelection.suggestions}
              onChange={workspaceSelection.setWorkspaceTags}
              onCreatingChange={setIsCreatingTag}
              disabled={isSubmitting || workspaceSelection.hasConflict}
            >
              <TaskDraftTags
                tags={workspaceSelection.visibleTopics}
                addedByJev={isCopy ? undefined : new Set(draftTags.tags)}
                status={draftTags.status}
                onRemove={workspaceSelection.removeTopic}
                disabled={isSubmitting || workspaceSelection.hasConflict}
              />
            </TaskWorkspaceTagPicker>
          ) : null}
          {showPrivateControl && labels.privateLabel ? (
            <PrivatePill
              pressed={isPrivate}
              label={labels.privateLabel}
              description={labels.privateDescription}
              onPressedChange={setIsPrivate}
            />
          ) : null}
        </div>
        {blocksOtherPeople && labels.privateOtherPeopleHint ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {labels.privateOtherPeopleHint}
          </p>
        ) : null}
        {shouldShowProjectSelect &&
        isProjectMissing &&
        labels.projectRequired ? (
          <p id={projectErrorId} className="text-destructive mt-2 text-xs">
            {labels.projectRequired}
          </p>
        ) : null}
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

      <TaskCreateProgress
        active={isSubmitting}
        needsName={!name.trim()}
        tagsReady={Boolean(submittedTagReceipt)}
        isCopy={isCopy}
      />

      <div className="flex shrink-0 flex-col gap-3 border-t px-5 py-3 md:flex-row md:items-center md:px-6">
        <div className="app-scrollbar -mx-5 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 [&>*]:shrink-0">
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
                  className="size-4 animate-spin motion-reduce:animate-pulse"
                  aria-hidden
                />
              ) : (
                <Paperclip className="size-4" aria-hidden />
              )}
            </button>
          </AttachmentSubmenu>
          {isTablePickerOpen ? (
            <TableAttachDialog
              onClose={() => setIsTablePickerOpen(false)}
              onPick={(file) => void handleAttachFiles([file])}
              returnFocusRef={attachButtonRef}
            />
          ) : null}
          {selectedOption && !isCopy ? (
            <TemplatePill
              assignee={selectedOption}
              onPick={(offer) => {
                if (!name.trim()) setName(offer.title);
                setDescription(offer.prompt);
              }}
            />
          ) : null}
          <TaskContextAttachmentsField
            layout="inline"
            defaultBrand={initialDesignMdAttachment ?? null}
            project={selectedProject}
            selection={contextSelection}
            onSelectionChange={setContextSelection}
          />
        </div>
        <div className="flex items-center justify-between gap-4 md:ml-auto">
          {isCopy ? null : (
            <label
              htmlFor={createMoreId}
              className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs font-medium select-none"
            >
              <Switch
                id={createMoreId}
                checked={createMore}
                onCheckedChange={setCreateMore}
              />
              {t("createMore")}
            </label>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            className={cn("gap-2", isMobile ? "min-w-28" : "")}
            disabled={isSaveDisabled}
            loading={isSubmitting}
            onClick={onSave}
          >
            {submitLabel}
            {!isMobile ? (
              <span
                aria-hidden
                className="hidden items-center gap-0.5 opacity-70 md:flex [&_svg]:size-3"
              >
                {os === "MacOS" ? <Command /> : labels.ctrl}
                <CornerDownLeft />
              </span>
            ) : null}
          </Button>
        </div>
      </div>
    </div>
  );
}

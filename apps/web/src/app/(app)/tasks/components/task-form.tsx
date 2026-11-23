"use client";

import { TaskStatus } from "@sokosumi/core-client";
import { isAgentOnlyTaskStatus } from "@sokosumi/utils";
import {
  ArrowLeft,
  CalendarClock,
  Command,
  CornerDownLeft,
  Loader2,
  Lock,
  Paperclip,
} from "lucide-react";
import { useState } from "react";
import { TableAttachDialog } from "@/app/drive/tables/table-attach-dialog";
import { InlineCreateProjectModal } from "@/app/projects/components/inline-create-project-modal";
import { isOtherHumanAssignee } from "@/app/tasks/utils/coworker-options";
import { VendorMark } from "@/components/agents/vendor-mark";
import { AssistantOrb } from "@/components/aurora-orb";
import { AttachmentSubmenu } from "@/components/drive/attachment-submenu";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { AgentSpotlight } from "./agent-spotlight";
import { MarkdownEditor } from "./markdown-editor";
import { TaskAssigneePicker } from "./task-assignee-picker";
import { TaskContextAttachmentsField } from "./task-context-attachments";
import { TaskCreateProgress } from "./task-create-progress";
import { TaskCreatedCelebration } from "./task-created-celebration";
import { TaskDraftTags } from "./task-draft-tags";
import { TaskFormModalHeaderStart } from "./task-form-modal";
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

import { SimilarTasksHint } from "./similar-tasks-hint";
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
  const [isTablePickerOpen, setIsTablePickerOpen] = useState(false);
  const {
    mode,
    taskId,
    labels,
    initialValues,
    initialDesignMdAttachment,
    onCreateAnother,
    showCancel,
    tRunAt,
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
    privateDescriptionId,
    contextSelection,
    setContextSelection,
    initialDescription,
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
    submittedTagReceipt,
    createdTask,
    pendingUploadFiles,
    setPendingUploadFiles,
    markdownEditorRef,
    attachmentTriggerRef,
    attachmentUrls,
    handleAttachFiles,
    handleRemoveAttachment,
    mentionOptions,
    isSubmittingAny,
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
    useWizard,
    step,
    setStep,
    showTaskStep,
    useComposeLayout,
    useModalFieldFill,
    taskStepTitle,
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
    showAssigneePicker,
    showModalCoworkerHeader,
    taskFieldsBorder,
    cardLabels,
    handleCancel,
    handleRunAtApply,
    handleRunAtClear,
    handleGoToTask,
  } = model;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="app-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
          {useWizard && step === 1 ? (
            <div className="flex min-h-0 flex-1 flex-col px-6 py-3 md:px-8 md:py-0">
              <AgentSpotlight
                options={availableAssigneeOptions}
                selectedId={assigneeId}
                onSelect={handleCoworkerSelect}
                onPickOffer={(offer) => {
                  setDescription(offer.prompt);
                  setStep(2);
                }}
                onStartFromScratch={() => {
                  setDescription(initialDescription);
                  setStep(2);
                }}
                labels={{
                  defaultBadge: cardLabels.defaultBadge,
                  modelLabel: cardLabels.modelLabel,
                  hostingLabel: cardLabels.hostingLabel,
                  tasksTitle: labels.tasksTitle ?? "Ready-To-Run Tasks",
                  startFromScratch:
                    labels.startFromScratch ?? "Start from scratch",
                  startFromScratchHint:
                    labels.startFromScratchHint ??
                    "Write your own instructions",
                  previewExample: labels.previewExample ?? "Preview example",
                  previewUse: labels.previewUse ?? "Use this task",
                  previewEmpty:
                    labels.previewEmpty ?? "No example output available yet.",
                  noResults: labels.noResults ?? "No agents found.",
                }}
              />
            </div>
          ) : null}

          {useWizard && step === 2 ? (
            <TaskFormModalHeaderStart>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-foreground -ml-2"
                onClick={() => {
                  setIsCreateProjectModalOpen(false);
                  setStep(1);
                }}
              >
                <ArrowLeft className="mr-1 size-3.5" />
                {labels.back}
              </Button>
            </TaskFormModalHeaderStart>
          ) : null}

          {showAssigneePicker ? (
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
                  option === "unassigned"
                    ? isAssigneeLockedToAgent
                    : blocksOtherPeople &&
                      option.kind === "user" &&
                      isOtherHumanAssignee(option.id, session?.user.id)
                }
              />
              {blocksOtherPeople && labels.privateOtherPeopleHint ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  {labels.privateOtherPeopleHint}
                </p>
              ) : null}
            </div>
          ) : showModalCoworkerHeader && selectedOption ? (
            <div className="flex items-center gap-3 px-6 py-4 md:px-8">
              {selectedOption.kind === "sokoBot" &&
              !selectedOption.image &&
              selectedOption.avatarSeed ? (
                <AssistantOrb
                  seed={selectedOption.avatarSeed}
                  expression="idle"
                  animate={false}
                  size={36}
                  className="size-9 shrink-0"
                  alt={selectedOption.name}
                />
              ) : (
                <Avatar className="ring-border size-9 shrink-0 rounded-full ring-1">
                  <AvatarImage
                    src={selectedOption.image}
                    alt={selectedOption.name}
                    className="object-cover"
                  />
                  <AvatarFallback className="rounded-full text-xs font-medium">
                    {selectedOption.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-tight font-semibold">
                  {selectedOption.name}
                </p>
                {selectedOption.caption ? (
                  <p className="text-muted-foreground truncate text-xs">
                    {selectedOption.caption}
                  </p>
                ) : null}
              </div>
              <VendorMark
                vendor={selectedOption.vendor}
                className="h-5 shrink-0"
                textClassName="text-muted-foreground shrink-0 text-xs font-medium"
              />
            </div>
          ) : null}

          {showTaskStep ? (
            <div
              className={cn(
                "space-y-4 px-6 py-5 md:px-8",
                taskFieldsBorder,
                useModalFieldFill && "flex min-h-0 flex-1 flex-col",
              )}
            >
              {useComposeLayout && selectedOption ? (
                <h3 className="text-lg font-semibold">
                  {taskStepTitle.replace("{name}", selectedOption.name)}
                </h3>
              ) : null}
              {/* Create shows the name only for a copy, so its title can be reviewed. */}
              {mode === "edit" || isCopy ? (
                // A textarea that grows, so a long title wraps on a phone instead of being cut off.
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
              ) : null}

              <div
                className={cn(
                  useModalFieldFill && "flex min-h-0 flex-1 flex-col",
                )}
              >
                <FileUpload
                  className={cn(useModalFieldFill && "min-h-0 flex-1")}
                  value={pendingUploadFiles}
                  onValueChange={setPendingUploadFiles}
                  onAccept={(files) => {
                    void handleAttachFiles(files);
                  }}
                  multiple
                >
                  <FileUploadDropzone
                    noClick
                    className={cn(
                      "data-dragging:bg-card-background w-full items-stretch justify-start border-0 p-0 hover:bg-transparent",
                      useModalFieldFill && "min-h-0 flex-1",
                    )}
                  >
                    <MarkdownEditor
                      ref={markdownEditorRef}
                      id="task-description"
                      variant="document"
                      ariaLabel={labels.details}
                      placeholder={labels.descriptionPlaceholder}
                      className={cn(
                        "w-full",
                        useModalFieldFill && "flex min-h-0 flex-1 flex-col",
                      )}
                      editorClassName={
                        useModalFieldFill ? "max-h-none flex-1" : undefined
                      }
                      value={description}
                      onChange={setDescription}
                      onSubmitShortcut={() => {
                        void handleSave();
                      }}
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

              {session && mode === "create" && !isCopy ? (
                <SimilarTasksHint
                  brief={description}
                  activeOrganizationId={
                    session.session.activeOrganizationId ?? null
                  }
                />
              ) : null}

              {session &&
              (!isCopy ||
                initialValues?.workspaceTags ||
                initialValues?.tags) ? (
                <TaskWorkspaceTagPicker
                  key={session.session.activeOrganizationId ?? session.user.id}
                  activeOrganizationId={
                    session.session.activeOrganizationId ?? null
                  }
                  canChooseWorkspaceTags={
                    !isCopy || initialValues?.workspaceTags !== undefined
                  }
                  copying={
                    isCopy && Boolean(initialValues?.workspaceTags?.length)
                  }
                  liveAutomaticIds={
                    mode === "create" && !isCopy
                      ? workspaceSelection.liveAutomaticIds
                      : undefined
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
                    addedByJev={
                      mode === "create" && !isCopy
                        ? new Set(draftTags.tags)
                        : undefined
                    }
                    status={draftTags.status}
                    onRemove={workspaceSelection.removeTopic}
                    disabled={isSubmitting || workspaceSelection.hasConflict}
                  />
                </TaskWorkspaceTagPicker>
              ) : null}

              {shouldShowProjectSelect || showPrivateControl ? (
                <div className="space-y-1">
                  <div
                    data-testid="task-compose-meta-row"
                    className="flex flex-wrap items-center gap-2"
                  >
                    {shouldShowProjectSelect ? (
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
                    ) : null}
                    {showPrivateControl ? (
                      <>
                        {labels.privateDescription ? (
                          <span id={privateDescriptionId} className="sr-only">
                            {labels.privateDescription}
                          </span>
                        ) : null}
                        <HoverCard openDelay={150}>
                          <HoverCardTrigger asChild>
                            <button
                              type="button"
                              id="task-private"
                              aria-label={labels.privateLabel}
                              aria-pressed={isPrivate}
                              aria-describedby={
                                labels.privateDescription
                                  ? privateDescriptionId
                                  : undefined
                              }
                              className={cn(
                                "focus-visible:ring-ring inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2",
                                isPrivate
                                  ? "bg-secondary text-secondary-foreground border-transparent"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                              )}
                              onClick={() =>
                                setIsPrivate((current) => !current)
                              }
                            >
                              <Lock className="size-3.5 shrink-0" aria-hidden />
                              {labels.privateLabel}
                            </button>
                          </HoverCardTrigger>
                          {labels.privateDescription ? (
                            <HoverCardContent
                              side="top"
                              align="start"
                              className="w-72 text-sm"
                            >
                              <p className="text-muted-foreground">
                                {labels.privateDescription}
                              </p>
                            </HoverCardContent>
                          ) : null}
                        </HoverCard>
                      </>
                    ) : null}
                  </div>
                  {shouldShowProjectSelect &&
                  isProjectMissing &&
                  labels.projectRequired ? (
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
          ) : null}
        </div>

        {showTaskStep && isRunAtModalOpen ? (
          <TaskRunAtModal
            runAt={runAt}
            onApply={handleRunAtApply}
            onClear={handleRunAtClear}
            onClose={() => setIsRunAtModalOpen(false)}
          />
        ) : null}

        {showTaskStep && shouldShowProjectSelect ? (
          <InlineCreateProjectModal
            open={isCreateProjectModalOpen}
            onOpenChange={setIsCreateProjectModalOpen}
            initialName={createProjectQuery}
            onCreated={handleProjectCreated}
          />
        ) : null}

        {showTaskStep && mode === "create" ? (
          <TaskCreateProgress
            active={isSubmitting}
            needsName={!name.trim()}
            tagsReady={Boolean(submittedTagReceipt)}
            isCopy={isCopy}
          />
        ) : null}

        {showTaskStep ? (
          <div className="flex shrink-0 flex-col items-stretch justify-between gap-3 border-t px-6 py-3 sm:flex-row sm:items-center md:px-8">
            <div className="app-scrollbar -m-1.5 flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto p-1.5">
              <AttachmentSubmenu
                onUploadClick={() => attachmentTriggerRef.current?.click()}
                onDriveClick={() =>
                  markdownEditorRef.current?.openDrivePicker()
                }
                onTableClick={() => setIsTablePickerOpen(true)}
                disabled={
                  createdTask !== null ||
                  isSubmittingAny ||
                  isUploadingAttachments
                }
              >
                <button
                  type="button"
                  aria-label={labels.uploadFile}
                  disabled={
                    createdTask !== null ||
                    isSubmittingAny ||
                    isUploadingAttachments
                  }
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
                    disabled={createdTask !== null}
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
                onClick={() => handleSave()}
              >
                <div className="flex items-center gap-2">
                  {mode === "create"
                    ? hasRunAt
                      ? (labels.scheduleTask ??
                        labels.createTask ??
                        labels.submit)
                      : (labels.createTask ?? labels.submit)
                    : labels.submit}
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
        ) : null}
      </section>
    </div>
  );
}

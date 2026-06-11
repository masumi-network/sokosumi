"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  chatModelSupportsImageGeneration,
  chatModelSupportsImageInput,
} from "@sokosumi/chat";
import { resolveUserUploadContentType } from "@sokosumi/utils";
import type { UIMessage } from "ai";
import { ImagePlus, Paperclip, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  filterCoworkersForComposeKind,
  findDefaultCoworker,
  getCoworkerImageUrl,
} from "@/app/chat/utils/coworker-utils";
import type {
  ChatComposeKind,
  ChatComposeMessage,
  ChatComposeSubmitOptions,
  ChatSendMessage,
  Coworker,
  TaskSubmitStatus,
} from "@/app/chat/utils/types";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/app/tasks/components/markdown-editor";
import { getTaskAttachmentUploadLabelTemplate } from "@/app/tasks/components/task-attachment-upload-labels";
import { createTaskAttachmentUploadToast } from "@/app/tasks/components/task-attachment-upload-toast";
import { CoworkerGalleryCard } from "@/components/agents/coworker-gallery-card";
import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getCoworkerMetadataChannels } from "@/lib/utils/coworker-channels";
import {
  createDesignMdDismissedState,
  ensureDesignMdInDescription,
  extractTaskAttachmentUrls,
  formatTaskAttachmentMarkdown,
  isDesignMdAttachmentSkipped,
  markDesignMdDismissed,
  removeDesignMdAttachmentLinks,
  removeTaskAttachmentLinks,
  sanitizeTaskAttachmentLabel,
  seedTaskDescriptionWithDesignMd,
  syncDesignMdDismissedState,
  type TaskDesignMdAttachmentSeed,
} from "@/lib/utils/task-attachments";
import { uploadTaskAttachment } from "@/lib/utils/task-attachments.client";
import {
  getUserFileUploadErrorMessage,
  type UserFileUploadProgress,
  uploadUserFileDirect,
} from "@/lib/utils/user-file-upload.client";
import { ComposeKindSelector } from "./compose-kind-selector";
import { CoworkerAvatarWithSkeleton } from "./coworker-avatar";
import CoworkerModelSelector from "./coworker-model-selector";
import { ArrowUpIcon, StopIcon } from "./icons";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "./prompt-input";
import { TaskSubmitStatusSelect } from "./task-submit-status-select";

interface MultimodalInputProps {
  chatId?: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<UIMessage>["status"];
  stop: () => void;
  messages: UIMessage[];
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  onSendMessage?: (
    message: ChatComposeMessage,
    coworker?: Coworker,
    model?: { id: string; name: string },
    options?: ChatComposeSubmitOptions,
  ) => boolean | Promise<boolean>;
  /** When true, send is disabled (e.g. welcome task creation in flight). */
  submitBlocked?: boolean;
  /**
   * When set (with {@link onComposeKindChange}), compose mode is controlled by the parent
   * so it stays in sync with surrounding UI (e.g. welcome header).
   */
  controlledComposeKind?: ChatComposeKind;
  onComposeKindChange?: (kind: ChatComposeKind) => void;
  onSelectModel?: (model: { id: string; name: string } | null) => void;
  selectedModel?: { id: string; name: string } | null;
  className?: string;
  showSuggestedActions?: boolean;
  coworker?: Coworker;
  coworkers?: Coworker[];
  coworkersLoading?: boolean;
  onCoworkerChange?: (coworker: Coworker | null) => void;
  enterSubmitsOnMobile?: boolean;
  blurOnSendOnMobile?: boolean;
  persistentImageGeneration?: boolean;
  initialDesignMdAttachment?: TaskDesignMdAttachmentSeed | null;
}

const TASK_MARKDOWN_EDITOR_ID = "chat-task-markdown-editor";

type ChatFilePart = Extract<UIMessage["parts"][number], { type: "file" }>;

function matchesCoworker(a: Coworker | null, b: Coworker | null): boolean {
  if (!a || !b) {
    return false;
  }

  return (
    a.id === b.id || a.slug === b.slug || a.id === b.slug || a.slug === b.id
  );
}

function buildChatMessagePayload(
  text: string,
  fileParts: ChatFilePart[],
): ChatSendMessage {
  const trimmedText = text.trim();
  const parts: UIMessage["parts"] = [
    ...(trimmedText ? [{ type: "text" as const, text: trimmedText }] : []),
    ...fileParts,
  ];

  return { parts } as ChatSendMessage;
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  messages: _messages,
  setMessages,
  sendMessage,
  onSendMessage,
  className,
  showSuggestedActions: _showSuggestedActions,
  coworker: propCoworker,
  onSelectModel,
  selectedModel: propSelectedModel,
  coworkers: propCoworkers,
  coworkersLoading: propCoworkersLoading,
  onCoworkerChange,
  enterSubmitsOnMobile = true,
  blurOnSendOnMobile = false,
  submitBlocked = false,
  controlledComposeKind,
  onComposeKindChange,
  persistentImageGeneration = false,
  initialDesignMdAttachment = null,
}: MultimodalInputProps) {
  const t = useTranslations("App.Chat.Chat");
  const tNewTask = useTranslations("App.Tasks.NewTask");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const attachmentTriggerRef = useRef<HTMLButtonElement>(null);
  const designMdStateRef = useRef(createDesignMdDismissedState());
  const activeUploadControllersRef = useRef(new Set<AbortController>());
  const [windowWidth, setWindowWidth] = useState<number | undefined>(undefined);
  const [internalComposeKind, setInternalComposeKind] =
    useState<ChatComposeKind>("chat");
  const isComposeKindControlled = controlledComposeKind !== undefined;
  // Compose-kind toggle is hidden when `chatId` is set; force chat so task-only state cannot block send.
  const storedComposeKind = controlledComposeKind ?? internalComposeKind;
  const composeKind: ChatComposeKind = chatId ? "chat" : storedComposeKind;
  const [taskStatus, setTaskStatus] = useState<TaskSubmitStatus>("READY");
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [chatFileParts, setChatFileParts] = useState<ChatFilePart[]>([]);
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(false);
  const [uploadingAttachmentsCount, setUploadingAttachmentsCount] = useState(0);
  const [preferredCoworker, setPreferredCoworker] = useState<Coworker | null>(
    () => {
      if (propCoworker) {
        return propCoworker;
      }
      if (propSelectedModel) {
        return null;
      }
      const initialComposeKind: ChatComposeKind = chatId
        ? "chat"
        : (controlledComposeKind ?? "task");
      return (
        findDefaultCoworker(
          filterCoworkersForComposeKind(
            propCoworkers ?? [],
            initialComposeKind,
          ),
        ) ?? null
      );
    },
  );
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(propSelectedModel ?? null);

  useEffect(() => {
    if (propSelectedModel) {
      setPreferredCoworker(null);
      return;
    }
    if (propCoworker) {
      const filteredCoworkers = filterCoworkersForComposeKind(
        [propCoworker],
        composeKind,
      );
      if (filteredCoworkers.length > 0) {
        setPreferredCoworker(filteredCoworkers[0] ?? null);
      } else {
        setPreferredCoworker(null);
      }
    }
  }, [composeKind, propCoworker, propSelectedModel]);

  useEffect(() => {
    if (propCoworker || propSelectedModel) {
      return;
    }
    setPreferredCoworker(
      findDefaultCoworker(
        filterCoworkersForComposeKind(propCoworkers ?? [], composeKind),
      ) ?? null,
    );
  }, [propCoworkers]);

  useEffect(() => {
    setSelectedModel(propSelectedModel ?? null);
  }, [propSelectedModel]);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    handleResize(); // Set initial width
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const width = windowWidth;
  const isTaskComposer = !chatId && composeKind === "task";
  if (isTaskComposer) {
    syncDesignMdDismissedState(
      input,
      initialDesignMdAttachment,
      designMdStateRef.current,
    );
  }
  const supportsChatImageInput = useMemo(
    () => chatModelSupportsImageInput(selectedModel?.id ?? null),
    [selectedModel?.id],
  );
  const supportsImageGeneration = useMemo(
    () =>
      selectedModel?.id
        ? chatModelSupportsImageGeneration(selectedModel.id)
        : false,
    [selectedModel?.id],
  );
  const effectiveImageGenerationEnabled =
    persistentImageGeneration || imageGenerationEnabled;
  const hasChatFileParts = !isTaskComposer && chatFileParts.length > 0;
  const isUploadingAttachments = uploadingAttachmentsCount > 0;
  const taskUploadFileLabel = tNewTask("uploadFile");
  const attachmentMenuTriggerLabel = t("attachmentMenu.trigger");
  const uploadFileMenuLabel = t("attachmentMenu.uploadFile");
  const createImageMenuLabel = t("attachmentMenu.createImage");
  const createImageChipLabel = t("createImageChip.label");
  const removeCreateImageLabel = t("createImageChip.remove");
  const taskUploadFileErrorLabel = tNewTask("uploadFileError");
  const removeAttachmentLabel = tNewTask("removeAttachment");
  const taskUploadingFileLabel = getTaskAttachmentUploadLabelTemplate(
    tNewTask,
    "uploadingFile",
  );
  const taskUploadingFilesLabel = getTaskAttachmentUploadLabelTemplate(
    tNewTask,
    "uploadingFiles",
  );

  const focusTaskEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      const editor = document.getElementById(TASK_MARKDOWN_EDITOR_ID);
      if (editor instanceof HTMLElement) {
        editor.focus();
      }
    });
  }, []);

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  useEffect(() => {
    if (!isTaskComposer && textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight, isTaskComposer]);

  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        if (isTaskComposer) {
          focusTaskEditor();
        } else {
          textareaRef.current?.focus();
        }
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [focusTaskEditor, isTaskComposer, width]);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  // Simple localStorage hook replacement
  const getLocalStorageValue = useCallback(
    (key: string, defaultValue: string) => {
      if (typeof window === "undefined") return defaultValue;
      try {
        const item = window.localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch {
        return defaultValue;
      }
    },
    [],
  );

  const setLocalStorageValue = useCallback((key: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const [localStorageInput] = useState(() =>
    getLocalStorageValue("chat-input", ""),
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
      return;
    }
    // Task welcome uses MarkdownEditor only (no textarea): still hydrate draft text.
    if (localStorageInput) {
      setInput((prev) => (prev ? prev : localStorageInput));
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageValue("chat-input", input);
  }, [input, setLocalStorageValue]);

  useEffect(() => {
    if (
      !isTaskComposer ||
      !initialDesignMdAttachment ||
      isDesignMdAttachmentSkipped(designMdStateRef.current)
    ) {
      return;
    }

    setInput((prev) =>
      seedTaskDescriptionWithDesignMd(prev, initialDesignMdAttachment),
    );
  }, [initialDesignMdAttachment, isTaskComposer, setInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const abortActiveUploads = useCallback(() => {
    for (const controller of activeUploadControllersRef.current) {
      controller.abort();
    }
    activeUploadControllersRef.current.clear();
  }, []);

  useEffect(() => abortActiveUploads, [abortActiveUploads]);

  useEffect(() => {
    if (!supportsChatImageInput) {
      setChatFileParts([]);
    }
  }, [supportsChatImageInput]);

  useEffect(() => {
    if (!supportsImageGeneration) {
      setImageGenerationEnabled(false);
    }
  }, [supportsImageGeneration]);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      if (composeKind === "chat" && !supportsChatImageInput) {
        return;
      }

      const uploadToast = createTaskAttachmentUploadToast({
        files,
        labels: {
          uploadingFile: taskUploadingFileLabel,
          uploadingFiles: taskUploadingFilesLabel,
        },
      });

      const controller = new AbortController();
      activeUploadControllersRef.current.add(controller);
      setUploadingAttachmentsCount((count) => count + 1);

      try {
        for (const [index, file] of files.entries()) {
          const uploadOptions = {
            abortSignal: controller.signal,
            onUploadProgress: (progress: UserFileUploadProgress) => {
              uploadToast.updateFileProgress(index, progress);
            },
          };

          if (composeKind === "chat") {
            const mediaType = resolveUserUploadContentType(
              file.name,
              file.type,
            );
            const uploaded = await uploadUserFileDirect(file, uploadOptions);
            uploadToast.markFileComplete(index);
            setChatFileParts((parts) => [
              ...parts,
              {
                type: "file",
                url: uploaded.publicUrl,
                mediaType: mediaType ?? file.type,
                filename: sanitizeTaskAttachmentLabel(file.name, "file"),
              },
            ]);
            continue;
          }

          const uploadedUrl = await uploadTaskAttachment(file, uploadOptions);
          uploadToast.markFileComplete(index);

          const safeName = sanitizeTaskAttachmentLabel(file.name, "file");
          if (markdownEditorRef.current) {
            markdownEditorRef.current.insertLink(safeName, uploadedUrl);
            markdownEditorRef.current.insertText("\n");
            continue;
          }

          const markdownLink = formatTaskAttachmentMarkdown(
            safeName,
            uploadedUrl,
          );
          setInput(
            (prev) =>
              `${prev}${prev.endsWith("\n") ? "" : "\n"}${markdownLink}`,
          );
        }

        uploadToast.dismiss();
      } catch (error) {
        uploadToast.dismiss();
        toast.error(
          getUserFileUploadErrorMessage(error, taskUploadFileErrorLabel),
        );
      } finally {
        activeUploadControllersRef.current.delete(controller);
        setPendingUploadFiles([]);
        setUploadingAttachmentsCount((count) => count - 1);
      }
    },
    [
      composeKind,
      setInput,
      supportsChatImageInput,
      taskUploadFileErrorLabel,
      taskUploadingFileLabel,
      taskUploadingFilesLabel,
    ],
  );

  const coworkers = propCoworkers ?? [];
  const availableCoworkers = useMemo(
    () => filterCoworkersForComposeKind(coworkers, composeKind),
    [composeKind, coworkers],
  );
  const selectedCoworker = useMemo(() => {
    const matchedCoworker =
      preferredCoworker == null
        ? null
        : (availableCoworkers.find((coworker) =>
            matchesCoworker(coworker, preferredCoworker),
          ) ?? null);

    return matchedCoworker ?? findDefaultCoworker(availableCoworkers);
  }, [availableCoworkers, preferredCoworker]);
  const attachmentUrls = useMemo(
    () => extractTaskAttachmentUrls(input),
    [input],
  );
  const canSubmitContent = input.trim().length > 0 || hasChatFileParts;
  const canSubmit =
    canSubmitContent &&
    status === "ready" &&
    !submitBlocked &&
    (composeKind === "chat"
      ? selectedCoworker != null || selectedModel != null
      : selectedCoworker != null) &&
    !isUploadingAttachments;
  const placeholder = t(
    composeKind === "task"
      ? "welcomeScreen.taskPlaceholder"
      : "welcomeScreen.placeholder",
    {
      coworkerSlug:
        selectedModel?.name ??
        selectedModel?.id ??
        selectedCoworker?.name ??
        selectedCoworker?.slug ??
        selectedCoworker?.id ??
        t("welcomeScreen.coworkerSlugFallback"),
    },
  );

  const submitForm = useCallback(async () => {
    if (blurOnSendOnMobile && width && width < 768) {
      if (isTaskComposer) {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } else {
        textareaRef.current?.blur();
      }
    }

    const sendPayload =
      composeKind === "chat"
        ? buildChatMessagePayload(input, chatFileParts)
        : ({ text: input.trim() } as ChatSendMessage);

    // Use onSendMessage if provided (for welcome screen to create conversation)
    // Otherwise use sendMessage from useChat hook
    if (onSendMessage) {
      const sendResult = await onSendMessage(
        sendPayload,
        selectedCoworker ?? undefined,
        selectedModel ?? undefined,
        {
          kind: composeKind,
          taskStatus,
          imageGeneration: effectiveImageGenerationEnabled,
          skipDesignMdAttachment:
            composeKind === "task"
              ? isDesignMdAttachmentSkipped(designMdStateRef.current)
              : undefined,
        },
      );
      if (sendResult !== true) {
        return;
      }
    } else {
      sendMessage(
        sendPayload,
        effectiveImageGenerationEnabled
          ? { body: { imageGeneration: true } }
          : undefined,
      );
    }

    setLocalStorageValue("chat-input", "");
    resetHeight();
    setInput("");
    setChatFileParts([]);
    setImageGenerationEnabled(false);

    if (width && width > 768) {
      if (isTaskComposer) {
        focusTaskEditor();
      } else {
        textareaRef.current?.focus();
      }
    }
  }, [
    blurOnSendOnMobile,
    chatFileParts,
    composeKind,
    focusTaskEditor,
    effectiveImageGenerationEnabled,
    input,
    isTaskComposer,
    onSendMessage,
    resetHeight,
    selectedCoworker,
    selectedModel,
    setInput,
    setLocalStorageValue,
    sendMessage,
    taskStatus,
    width,
  ]);

  const getCoworkerAvatarUrl = (c: Coworker): string | null =>
    getCoworkerImageUrl(c.id, c.avatar ?? undefined);

  const handleCoworkerSelect = useCallback(
    (coworker: Coworker) => {
      setPreferredCoworker(coworker);
      setSelectedModel(null); // Clear model when selecting coworker
      onSelectModel?.(null);
      onCoworkerChange?.(coworker);
    },
    [onSelectModel, onCoworkerChange],
  );

  const handleModelSelect = useCallback(
    (model: { id: string; name: string } | null) => {
      if (model) {
        setSelectedModel(model);
        onSelectModel?.(model);
      } else {
        setSelectedModel(null);
        onSelectModel?.(null);
      }
    },
    [onSelectModel],
  );
  const handleComposeKindChange = useCallback(
    (value: string) => {
      if (value !== "chat" && value !== "task") {
        return;
      }

      const nextKind = value as ChatComposeKind;
      if (nextKind === composeKind) {
        return;
      }

      if (!isComposeKindControlled) {
        setInternalComposeKind(nextKind);
      }
      onComposeKindChange?.(nextKind);
      if (nextKind === "task") {
        focusTaskEditor();
      } else {
        textareaRef.current?.focus();
      }

      if (nextKind === "task") {
        setSelectedModel(null);
        onSelectModel?.(null);
        const taskCoworkers = filterCoworkersForComposeKind(coworkers, "task");
        const hasCurrentTaskCoworker = taskCoworkers.some((coworker) =>
          matchesCoworker(coworker, preferredCoworker),
        );
        if (!hasCurrentTaskCoworker) {
          const defaultTaskCoworker = findDefaultCoworker(taskCoworkers);
          setPreferredCoworker(defaultTaskCoworker);
          onCoworkerChange?.(defaultTaskCoworker);
        }
        if (
          initialDesignMdAttachment &&
          !isDesignMdAttachmentSkipped(designMdStateRef.current)
        ) {
          setInput((prev) =>
            ensureDesignMdInDescription(prev, initialDesignMdAttachment),
          );
        }
        return;
      }

      const chatCoworkers = filterCoworkersForComposeKind(coworkers, "chat");
      const hasCurrentChatCoworker = chatCoworkers.some((coworker) =>
        matchesCoworker(coworker, preferredCoworker),
      );
      if (!hasCurrentChatCoworker) {
        const defaultChatCoworker = findDefaultCoworker(chatCoworkers);
        setPreferredCoworker(defaultChatCoworker);
        onCoworkerChange?.(defaultChatCoworker);
      }

      setInput((prev) => removeDesignMdAttachmentLinks(prev));
    },
    [
      composeKind,
      coworkers,
      focusTaskEditor,
      initialDesignMdAttachment,
      isComposeKindControlled,
      onComposeKindChange,
      onCoworkerChange,
      onSelectModel,
      preferredCoworker,
      setInput,
    ],
  );

  const handleRemoveAttachment = useCallback(
    (url: string) => {
      if (initialDesignMdAttachment?.url === url) {
        markDesignMdDismissed(designMdStateRef.current);
      }
      setInput((prev) => removeTaskAttachmentLinks(prev, [url]));
    },
    [initialDesignMdAttachment?.url, setInput],
  );

  const handleRemoveChatAttachment = useCallback((url: string) => {
    setChatFileParts((parts) => parts.filter((part) => part.url !== url));
  }, []);

  const handleEnableImageGeneration = useCallback(() => {
    if (!supportsImageGeneration) {
      return;
    }
    setImageGenerationEnabled(true);
  }, [supportsImageGeneration]);

  const showAttachmentMenu =
    composeKind === "chat" &&
    (supportsChatImageInput || supportsImageGeneration);

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {!chatId && (
        <div className="flex items-center justify-center gap-2">
          <span className="text-muted-foreground text-xs">
            {t("introducingCoworkers")}
          </span>
          <div className="flex -space-x-2">
            {propCoworkersLoading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <Skeleton
                    key={i}
                    className="size-[1.8rem] shrink-0 rounded-full"
                  />
                ))}
              </>
            ) : (
              availableCoworkers.slice(0, 3).map((coworker: Coworker) => (
                <Tooltip key={coworker.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer"
                      onClick={() => handleCoworkerSelect(coworker)}
                    >
                      <CoworkerAvatarWithSkeleton
                        coworker={coworker}
                        getAvatarUrl={getCoworkerAvatarUrl}
                        className="size-[1.8rem]"
                        avatarClassName="border-background border-2 transition-transform hover:scale-110"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    hideArrow
                    className="bg-popover text-popover-foreground border-border max-w-xs p-0"
                  >
                    <CoworkerGalleryCard
                      className="w-full"
                      slug={coworker.slug ?? ""}
                      name={coworker.name}
                      image={coworker.avatar}
                      caption={coworker.caption}
                      description={coworker.description}
                      channels={getCoworkerMetadataChannels({
                        metadata: coworker.metadata ?? null,
                      })}
                      action={
                        <Button
                          type="button"
                          size="sm"
                          variant="default"
                          onClick={() => handleCoworkerSelect(coworker)}
                          className="w-full"
                        >
                          {t("selectCoworker.selectButton", {
                            coworker: coworker.name,
                          })}
                        </Button>
                      }
                    />
                  </TooltipContent>
                </Tooltip>
              ))
            )}
          </div>
        </div>
      )}

      <PromptInput
        data-chat-input-border-anchor
        className="border-border bg-background focus-within:border-border hover:border-muted-foreground/50 rounded-xl border transition-all duration-200"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) {
            return;
          }
          void submitForm();
        }}
      >
        <div className="flex flex-row items-start gap-1 sm:gap-2">
          {isTaskComposer ? (
            <FileUpload
              value={pendingUploadFiles}
              onValueChange={setPendingUploadFiles}
              onAccept={(files) => {
                void handleAttachFiles(files);
              }}
              multiple
              className="w-full"
            >
              <FileUploadDropzone
                className="data-dragging:bg-accent/20 w-full items-stretch justify-start border-0 p-0 hover:bg-transparent"
                onClick={(event) => event.preventDefault()}
              >
                <MarkdownEditor
                  ref={markdownEditorRef}
                  id={TASK_MARKDOWN_EDITOR_ID}
                  placeholder={placeholder}
                  className="w-full border-0 bg-transparent"
                  value={input}
                  onChange={setInput}
                  onSubmitShortcut={() => {
                    if (canSubmit) {
                      void submitForm();
                    }
                  }}
                  onAttachClick={() => attachmentTriggerRef.current?.click()}
                  attachLabel={taskUploadFileLabel}
                  isAttachmentUploading={isUploadingAttachments}
                  mentions={{}}
                />
                <FileUploadTrigger asChild>
                  <button
                    ref={attachmentTriggerRef}
                    type="button"
                    className="sr-only"
                    aria-label={taskUploadFileLabel}
                  >
                    {taskUploadFileLabel}
                  </button>
                </FileUploadTrigger>
              </FileUploadDropzone>
            </FileUpload>
          ) : supportsChatImageInput ? (
            <FileUpload
              value={pendingUploadFiles}
              onValueChange={setPendingUploadFiles}
              onAccept={(files) => {
                void handleAttachFiles(files);
              }}
              multiple
              disabled={isUploadingAttachments}
              className="w-full"
            >
              <FileUploadDropzone className="data-dragging:bg-accent/20 w-full items-stretch justify-start border-0 p-0 hover:bg-transparent">
                <PromptInputTextarea
                  allowEnterToSubmitOnMobile={enterSubmitsOnMobile}
                  className="placeholder:text-muted-foreground grow resize-none border-0! border-none! bg-transparent p-4 text-base ring-0 outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
                  data-testid="multimodal-input"
                  disableAutoResize={true}
                  maxHeight={200}
                  minHeight={44}
                  onClick={(event) => event.stopPropagation()}
                  onChange={handleInput}
                  placeholder={placeholder}
                  ref={textareaRef}
                  rows={1}
                  value={input}
                />
                <FileUploadTrigger asChild>
                  <button
                    ref={attachmentTriggerRef}
                    type="button"
                    className="sr-only"
                    aria-label={taskUploadFileLabel}
                  >
                    {taskUploadFileLabel}
                  </button>
                </FileUploadTrigger>
              </FileUploadDropzone>
            </FileUpload>
          ) : (
            <PromptInputTextarea
              allowEnterToSubmitOnMobile={enterSubmitsOnMobile}
              className="placeholder:text-muted-foreground grow resize-none border-0! border-none! bg-transparent p-4 text-base ring-0 outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
              data-testid="multimodal-input"
              disableAutoResize={true}
              maxHeight={200}
              minHeight={44}
              onClick={(event) => event.stopPropagation()}
              onChange={handleInput}
              placeholder={placeholder}
              ref={textareaRef}
              rows={1}
              value={input}
            />
          )}
        </div>
        {!chatId &&
        composeKind === "task" &&
        availableCoworkers.length === 0 ? (
          <p className="text-muted-foreground px-2 pb-1 text-xs">
            {t("noTaskCoworkers")}
          </p>
        ) : null}
        {isTaskComposer && attachmentUrls.length > 0 ? (
          <div className="flex flex-wrap gap-3 px-2 pb-1">
            {attachmentUrls.map((url) => (
              <FileChipMiniPreviewWithMetadata
                key={url}
                url={url}
                onRemove={() => handleRemoveAttachment(url)}
                removeLabel={removeAttachmentLabel}
              />
            ))}
          </div>
        ) : null}
        {!isTaskComposer &&
        (chatFileParts.length > 0 || effectiveImageGenerationEnabled) ? (
          <div className="flex flex-col items-start gap-3 px-2 pb-1">
            {chatFileParts.length > 0 ? (
              <div className="flex w-full flex-wrap items-start gap-3">
                {chatFileParts.map((part) => (
                  <FileChipMiniPreviewWithMetadata
                    key={part.url}
                    url={part.url}
                    fileName={part.filename}
                    onRemove={() => handleRemoveChatAttachment(part.url)}
                    removeLabel={removeAttachmentLabel}
                  />
                ))}
              </div>
            ) : null}
            {effectiveImageGenerationEnabled ? (
              <div className="bg-muted text-foreground flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
                <ImagePlus className="text-muted-foreground size-3.5" />
                <span>{createImageChipLabel}</span>
                {!persistentImageGeneration ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground rounded-full p-0.5 transition-colors"
                    aria-label={removeCreateImageLabel}
                    onClick={() => setImageGenerationEnabled(false)}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <PromptInputToolbar className="border-top-0! border-t-0! p-3 dark:border-0 dark:border-transparent!">
          <PromptInputTools className="flex-wrap gap-1 sm:gap-1.5">
            {showAttachmentMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-8 rounded-full! p-0"
                    disabled={isUploadingAttachments}
                    title={attachmentMenuTriggerLabel}
                    aria-label={attachmentMenuTriggerLabel}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" sideOffset={8}>
                  {supportsChatImageInput ? (
                    <DropdownMenuItem
                      disabled={isUploadingAttachments}
                      onSelect={() => attachmentTriggerRef.current?.click()}
                    >
                      <Paperclip className="size-4" />
                      {uploadFileMenuLabel}
                    </DropdownMenuItem>
                  ) : null}
                  {supportsImageGeneration ? (
                    <DropdownMenuItem
                      disabled={
                        isUploadingAttachments ||
                        effectiveImageGenerationEnabled
                      }
                      onSelect={handleEnableImageGeneration}
                    >
                      <ImagePlus className="size-4" />
                      {createImageMenuLabel}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {!chatId ? (
              <ComposeKindSelector
                value={composeKind}
                onValueChange={handleComposeKindChange}
              />
            ) : null}
            {!chatId && composeKind === "task" ? (
              <TaskSubmitStatusSelect
                value={taskStatus}
                onValueChange={setTaskStatus}
              />
            ) : null}
            <CoworkerModelSelector
              selectedCoworker={selectedCoworker}
              selectedModel={selectedModel}
              coworkers={availableCoworkers}
              coworkersLoading={propCoworkersLoading}
              onSelectCoworker={handleCoworkerSelect}
              onSelectModel={handleModelSelect}
              disabled={
                !!chatId ||
                (composeKind === "task" && availableCoworkers.length === 0)
              }
              showModels={composeKind === "chat"}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full transition-colors duration-200"
              data-testid="send-button"
              disabled={!canSubmit}
              status={status}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}

function areMultimodalInputPropsEqual(
  prevProps: Readonly<MultimodalInputProps>,
  nextProps: Readonly<MultimodalInputProps>,
): boolean {
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.chatId !== nextProps.chatId) {
    return false;
  }
  if (prevProps.submitBlocked !== nextProps.submitBlocked) {
    return false;
  }
  if (prevProps.controlledComposeKind !== nextProps.controlledComposeKind) {
    return false;
  }
  if (prevProps.className !== nextProps.className) {
    return false;
  }
  if (prevProps.coworkers !== nextProps.coworkers) {
    return false;
  }
  if (prevProps.coworkersLoading !== nextProps.coworkersLoading) {
    return false;
  }
  if (prevProps.enterSubmitsOnMobile !== nextProps.enterSubmitsOnMobile) {
    return false;
  }
  if (prevProps.blurOnSendOnMobile !== nextProps.blurOnSendOnMobile) {
    return false;
  }
  if (
    prevProps.persistentImageGeneration !== nextProps.persistentImageGeneration
  ) {
    return false;
  }
  if (prevProps.coworker?.id !== nextProps.coworker?.id) {
    return false;
  }
  if (prevProps.selectedModel?.id !== nextProps.selectedModel?.id) {
    return false;
  }
  if (prevProps.setInput !== nextProps.setInput) {
    return false;
  }
  if (prevProps.onSendMessage !== nextProps.onSendMessage) {
    return false;
  }
  if (prevProps.sendMessage !== nextProps.sendMessage) {
    return false;
  }
  if (prevProps.onComposeKindChange !== nextProps.onComposeKindChange) {
    return false;
  }
  if (prevProps.onSelectModel !== nextProps.onSelectModel) {
    return false;
  }
  if (prevProps.onCoworkerChange !== nextProps.onCoworkerChange) {
    return false;
  }
  if (
    prevProps.initialDesignMdAttachment?.url !==
    nextProps.initialDesignMdAttachment?.url
  ) {
    return false;
  }

  // `messages` is not read in the component body; ignore unstable `[]` from welcome shell.

  if (prevProps.status === "submitted" && nextProps.status === "submitted") {
    if (prevProps.stop !== nextProps.stop) {
      return false;
    }
    if (prevProps.setMessages !== nextProps.setMessages) {
      return false;
    }
  }

  return true;
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  areMultimodalInputPropsEqual,
);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
}) {
  return (
    <Button
      className="bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground size-7 rounded-full p-1 transition-colors duration-200"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);

"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { Coworker } from "@/app/chat/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import CoworkerModelSelector from "./coworker-model-selector";
import { ArrowUpIcon, StopIcon } from "./icons";
import { type Attachment, PreviewAttachment } from "./preview-attachment";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "./prompt-input";

interface MultimodalInputProps {
  chatId?: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<UIMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  onSendMessage?: (
    message: string,
    coworker?: Coworker,
    model?: { id: string; name: string },
  ) => void;
  onSelectModel?: (model: { id: string; name: string } | null) => void;
  selectedModel?: { id: string; name: string } | null;
  className?: string;
  showSuggestedActions?: boolean;
  coworker?: Coworker;
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages: _messages,
  setMessages,
  sendMessage,
  onSendMessage,
  className,
  showSuggestedActions: _showSuggestedActions,
  coworker: propCoworker,
  onSelectModel,
  selectedModel: propSelectedModel,
}: MultimodalInputProps) {
  const t = useTranslations("App.Chat.Chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [windowWidth, setWindowWidth] = useState<number | undefined>(undefined);
  const defaultCoworker: Coworker = {
    id: "hannah",
    name: t("coworkers.hannah.name"),
    description: t("coworkers.hannah.description"),
    useCase: t("coworkers.hannah.useCase"),
  };
  const [selectedCoworker, setSelectedCoworker] = useState<Coworker>(
    propCoworker || defaultCoworker,
  );
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(propSelectedModel || null);

  // Update selectedCoworker when propCoworker changes (for existing chats)
  useEffect(() => {
    if (propCoworker) {
      setSelectedCoworker(propCoworker);
    }
  }, [propCoworker]);

  // Update selectedModel when propSelectedModel changes
  useEffect(() => {
    if (propSelectedModel !== undefined) {
      setSelectedModel(propSelectedModel);
    }
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

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

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
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLocalStorageValue("chat-input", input);
  }, [input, setLocalStorageValue]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);

  const submitForm = useCallback(() => {
    // Use onSendMessage if provided (for welcome screen to create conversation)
    // Otherwise use sendMessage from useChat hook
    if (onSendMessage) {
      onSendMessage(input, selectedCoworker, selectedModel || undefined);
    } else {
      // For now, use text-only format (file attachments can be added later)
      // The sendMessage function from useChat accepts { text: string } format
      sendMessage({ text: input } as never);
    }

    setAttachments([]);
    setLocalStorageValue("chat-input", "");
    resetHeight();
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    sendMessage,
    onSendMessage,
    setAttachments,
    setLocalStorageValue,
    width,
    resetHeight,
    selectedCoworker,
    selectedModel,
  ]);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error || "Failed to upload file");
    } catch (_error) {
      toast.error("Failed to upload file, please try again!");
    }
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined,
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error("Error uploading files!", error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile],
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/"),
      );

      if (imageItems.length === 0) {
        return;
      }

      // Prevent default paste behavior for images
      event.preventDefault();

      setUploadQueue((prev) => [...prev, "Pasted image"]);

      try {
        const uploadPromises = imageItems
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null)
          .map((file) => uploadFile(file));

        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) =>
            attachment !== undefined &&
            attachment.url !== undefined &&
            attachment.contentType !== undefined,
        );

        setAttachments((curr) => [
          ...curr,
          ...(successfullyUploadedAttachments as Attachment[]),
        ]);
      } catch (error) {
        console.error("Error uploading pasted images:", error);
        toast.error("Failed to upload pasted image(s)");
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile],
  );

  // Add paste event listener to textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("paste", handlePaste);
    return () => textarea.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const coworkers: Coworker[] = [
    {
      id: "hannah",
      name: t("coworkers.hannah.name"),
      description: t("coworkers.hannah.description"),
      useCase: t("coworkers.hannah.useCase"),
    },
    {
      id: "john",
      name: t("coworkers.john.name"),
      description: t("coworkers.john.description"),
      useCase: t("coworkers.john.useCase"),
    },
    {
      id: "demosthenes",
      name: t("coworkers.demosthenes.name"),
      description: t("coworkers.demosthenes.description"),
      useCase: t("coworkers.demosthenes.useCase"),
    },
  ];

  // Helper function to get coworker image URL
  const getCoworkerImageUrl = (coworkerId: string): string | null => {
    const imageMap: Record<string, string> = {
      hannah: "/images/coworkers/hannah.png",
      demosthenes: "/images/coworkers/demosthenes.png",
    };
    return imageMap[coworkerId] || null;
  };

  const handleCoworkerSelect = useCallback(
    (coworker: Coworker) => {
      setSelectedCoworker(coworker);
      setSelectedModel(null); // Clear model when selecting coworker
      onSelectModel?.(null);
    },
    [onSelectModel],
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

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {!chatId && (
        <div className="flex items-center justify-center gap-2">
          <span className="text-muted-foreground text-xs">
            {t("introducingCoworkers", {
              default: "Introducing: Agentic Coworkers",
            })}
          </span>
          <div className="flex -space-x-2">
            {coworkers.slice(0, 3).map((coworker) => (
              <Tooltip key={coworker.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="cursor-pointer"
                    onClick={() => handleCoworkerSelect(coworker)}
                  >
                    <Avatar className="border-background size-[1.8rem] border-2 transition-transform hover:scale-110">
                      {getCoworkerImageUrl(coworker.id) && (
                        <AvatarImage
                          src={getCoworkerImageUrl(coworker.id)!}
                          alt={coworker.name}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                        {coworker.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  hideArrow
                  className="bg-popover text-popover-foreground border-border max-w-xs rounded-lg border p-3 shadow-lg"
                >
                  <div className="flex flex-col gap-2">
                    <div>
                      <h4 className="text-sm font-semibold">{coworker.name}</h4>
                      <p className="text-muted-foreground text-xs">
                        {coworker.description}
                      </p>
                      {coworker.useCase && (
                        <p className="text-muted-foreground mt-1.5 text-xs italic">
                          {coworker.useCase}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={() => handleCoworkerSelect(coworker)}
                      className="w-full"
                    >
                      Select {coworker.name}
                    </Button>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
      <input
        className="pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <PromptInput
        className="border-border bg-background focus-within:border-border hover:border-muted-foreground/50 rounded-xl border p-3 shadow-xs transition-all duration-200"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() && attachments.length === 0) {
            return;
          }
          if (status !== "ready") {
            toast.error("Please wait for the model to finish its response!");
          } else {
            submitForm();
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex flex-row items-end gap-2 overflow-x-scroll"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url),
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: "",
                  name: filename,
                  contentType: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <div className="flex flex-row items-start gap-1 sm:gap-2">
          <PromptInputTextarea
            className="placeholder:text-muted-foreground grow resize-none border-0! border-none! bg-transparent p-2 text-base ring-0 outline-none [-ms-overflow-style:none] [scrollbar-width:none] focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none [&::-webkit-scrollbar]:hidden"
            data-testid="multimodal-input"
            disableAutoResize={true}
            maxHeight={200}
            minHeight={44}
            onChange={handleInput}
            placeholder={t("welcomeScreen.placeholder")}
            ref={textareaRef}
            rows={1}
            value={input}
          />
        </div>
        <PromptInputToolbar className="border-top-0! border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <CoworkerModelSelector
              selectedCoworker={selectedCoworker}
              selectedModel={selectedModel}
              onSelectCoworker={handleCoworkerSelect}
              onSelectModel={handleModelSelect}
              disabled={!!chatId}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="disabled:bg-muted disabled:text-muted-foreground size-8 rounded-md bg-black text-white transition-colors duration-200 hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
              data-testid="send-button"
              disabled={!input.trim() || uploadQueue.length > 0}
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

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    // Simple shallow comparison for attachments array
    if (prevProps.attachments.length !== nextProps.attachments.length) {
      return false;
    }
    for (let i = 0; i < prevProps.attachments.length; i++) {
      if (
        prevProps.attachments[i]?.url !== nextProps.attachments[i]?.url ||
        prevProps.attachments[i]?.name !== nextProps.attachments[i]?.name
      ) {
        return false;
      }
    }

    return true;
  },
);

// AttachmentsButton component removed - attachment functionality hidden for now

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

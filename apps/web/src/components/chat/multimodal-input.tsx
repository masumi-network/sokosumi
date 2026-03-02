"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useTranslations } from "next-intl";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";
import { CoworkerGalleryCard } from "@/components/agents/coworker-gallery-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
    message: string,
    coworker?: Coworker,
    model?: { id: string; name: string },
  ) => void;
  onSelectModel?: (model: { id: string; name: string } | null) => void;
  selectedModel?: { id: string; name: string } | null;
  className?: string;
  showSuggestedActions?: boolean;
  coworker?: Coworker;
  coworkers?: Coworker[];
  coworkersLoading?: boolean;
  onCoworkerChange?: (coworker: Coworker) => void;
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
}: MultimodalInputProps) {
  const t = useTranslations("App.Chat.Chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [windowWidth, setWindowWidth] = useState<number | undefined>(undefined);
  const defaultSlug = "elena";
  const findDefaultCoworker = (list: Coworker[] | undefined) =>
    list?.find(
      (c) =>
        c.slug?.toLowerCase() === defaultSlug ||
        c.id?.toLowerCase() === defaultSlug,
    ) ??
    list?.[0] ??
    null;
  const initialDefault = findDefaultCoworker(propCoworkers);
  const [selectedCoworker, setSelectedCoworker] = useState<Coworker | null>(
    propCoworker ?? (propSelectedModel ? null : initialDefault),
  );
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
  } | null>(propSelectedModel ?? null);

  // Sync selected agent from props when switching conversations (model vs coworker).
  useEffect(() => {
    const defaultCoworker = findDefaultCoworker(propCoworkers);
    setSelectedCoworker(
      propCoworker ?? (propSelectedModel ? null : defaultCoworker),
    );
  }, [propCoworker, propSelectedModel, propCoworkers]);

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

  const submitForm = useCallback(() => {
    // On mobile, blur first so the keyboard dismisses and input returns to normal position.
    if (width && width < 768) {
      textareaRef.current?.blur();
    }

    // Use onSendMessage if provided (for welcome screen to create conversation)
    // Otherwise use sendMessage from useChat hook
    if (onSendMessage) {
      onSendMessage(
        input,
        selectedCoworker ?? undefined,
        selectedModel ?? undefined,
      );
    } else {
      sendMessage({ text: input } as never);
    }

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
    setLocalStorageValue,
    width,
    resetHeight,
    selectedCoworker,
    selectedModel,
  ]);

  const coworkers = propCoworkers ?? [];

  const getCoworkerAvatarUrl = (c: Coworker): string | null =>
    getCoworkerImageUrl(c.id, c.avatar ?? undefined);

  const handleCoworkerSelect = useCallback(
    (coworker: Coworker) => {
      setSelectedCoworker(coworker);
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
              coworkers.slice(0, 3).map((coworker: Coworker) => (
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
        className="border-border bg-background focus-within:border-border hover:border-muted-foreground/50 rounded-xl border p-3 transition-all duration-200"
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim() || status !== "ready") {
            return;
          }
          submitForm();
        }}
      >
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
        <PromptInputToolbar className="border-top-0! border-t-0! p-0 dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <CoworkerModelSelector
              selectedCoworker={selectedCoworker}
              selectedModel={selectedModel}
              coworkers={coworkers}
              coworkersLoading={propCoworkersLoading}
              onSelectCoworker={handleCoworkerSelect}
              onSelectModel={handleModelSelect}
              disabled={!!chatId}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full transition-colors duration-200"
              data-testid="send-button"
              disabled={!input.trim() || status !== "ready"}
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
    if (prevProps.coworkers !== nextProps.coworkers) {
      return false;
    }
    if (prevProps.coworkersLoading !== nextProps.coworkersLoading) {
      return false;
    }

    return true;
  },
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

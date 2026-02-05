"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// eslint-disable-next-line no-relative-import-paths/no-relative-import-paths
import type { Coworker } from "../../app/(app)/chat/utils/types";

interface Model {
  id: string;
  name: string;
  icon?: React.ReactNode;
}

interface CoworkerModelSelectorProps {
  selectedCoworker: Coworker;
  selectedModel?: Model | null;
  onSelectCoworker: (coworker: Coworker) => void;
  onSelectModel?: (model: Model | null) => void;
  disabled?: boolean;
}

export default function CoworkerModelSelector({
  selectedCoworker,
  selectedModel,
  onSelectCoworker,
  onSelectModel,
  disabled = false,
}: CoworkerModelSelectorProps) {
  const t = useTranslations("App.Chat.Chat");
  const [open, setOpen] = useState(false);

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

  const models: Model[] = [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt4o", name: "GPT-4o" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "mixtral-8x22b", name: "Mixtral 8x22B" },
    { id: "mixtral-8x7b", name: "Mixtral 8x7B" },
  ];

  // Helper function to get coworker image URL
  const getCoworkerImageUrl = (coworkerId: string): string | null => {
    const imageMap: Record<string, string> = {
      hannah: "/images/coworkers/hannah.png",
      demosthenes: "/images/coworkers/demosthenes.png",
    };
    return imageMap[coworkerId] || null;
  };

  // Helper function to get model image URL
  const getModelImageUrl = (
    modelId: string,
  ): { light: string; dark: string } | null => {
    // OpenAI models
    if (
      modelId === "gpt4" ||
      modelId === "gpt4o" ||
      modelId === "gpt-4o-mini"
    ) {
      return {
        light: "/images/models/openai-black.png",
        dark: "/images/models/openai-white.png",
      };
    }
    // Gemini models
    if (modelId.startsWith("gemini")) {
      return {
        light: "/images/models/gemini.png",
        dark: "/images/models/gemini.png",
      };
    }
    return null;
  };

  // Model icon component
  const ModelIcon = ({
    modelId,
    className,
  }: {
    modelId: string;
    className?: string;
  }) => {
    const imageUrls = getModelImageUrl(modelId);

    if (!imageUrls) {
      // Fallback to generic icon for models without logos
      return (
        <div
          className={cn(
            "flex size-6 items-center justify-center rounded-full bg-teal-500/20",
            className,
          )}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-teal-600"
          >
            <path
              d="M8 2C4.7 2 2 4.7 2 8C2 11.3 4.7 14 8 14C11.3 14 14 11.3 14 8C14 4.7 11.3 2 8 2ZM8 12.5C5.5 12.5 3.5 10.5 3.5 8C3.5 5.5 5.5 3.5 8 3.5C10.5 3.5 12.5 5.5 12.5 8C12.5 10.5 10.5 12.5 8 12.5Z"
              fill="currentColor"
            />
            <path
              d="M6 6C6.5 5.5 7.2 5.2 8 5.2C8.8 5.2 9.5 5.5 10 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <path
              d="M6 10C6.5 10.5 7.2 10.8 8 10.8C8.8 10.8 9.5 10.5 10 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      );
    }

    return (
      <div
        className={cn(
          "flex size-6 items-center justify-center overflow-hidden rounded-full",
          className,
        )}
      >
        <img
          src={imageUrls.light}
          alt=""
          className="block size-full object-contain dark:hidden"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        <img
          src={imageUrls.dark}
          alt=""
          className="hidden size-full object-contain dark:block"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </div>
    );
  };

  const handleCoworkerSelect = (coworker: Coworker) => {
    onSelectCoworker(coworker);
    setOpen(false);
  };

  const handleModelSelect = (model: Model) => {
    onSelectModel?.(model);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectedModel ? (
            <>
              <ModelIcon
                modelId={selectedModel.id}
                className="size-5 shrink-0"
              />
              <span className="hidden sm:inline">{selectedModel.name}</span>
            </>
          ) : (
            <>
              <Avatar className="size-5 shrink-0">
                {getCoworkerImageUrl(selectedCoworker.id) && (
                  <AvatarImage
                    src={getCoworkerImageUrl(selectedCoworker.id)!}
                    alt={selectedCoworker.name}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {selectedCoworker.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:inline">{selectedCoworker.name}</span>
            </>
          )}
          <ChevronDown className="text-muted-foreground size-3 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-0"
        align="start"
        side="top"
        sideOffset={8}
      >
        <div className="flex flex-col">
          {/* Agentic Coworkers Section */}
          <div className="px-3 pt-3 pb-2">
            <h3 className="text-foreground text-xs font-semibold">
              Agentic Coworkers
            </h3>
          </div>
          <div className="px-1 pb-2">
            {coworkers.map((coworker) => (
              <button
                key={coworker.id}
                type="button"
                onClick={() => handleCoworkerSelect(coworker)}
                className={cn(
                  "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm transition-colors",
                  selectedCoworker.id === coworker.id && "bg-accent",
                )}
              >
                <Avatar className="size-6 shrink-0">
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
                <span className="flex-1 text-left">{coworker.name}</span>
              </button>
            ))}
          </div>

          {/* Models Section */}
          <div className="border-t px-3 pt-3 pb-2">
            <h3 className="text-foreground text-xs font-semibold">Models</h3>
          </div>
          <div className="px-1 pb-2">
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => handleModelSelect(model)}
                className={cn(
                  "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm transition-colors",
                  selectedModel?.id === model.id && "bg-accent",
                )}
              >
                <ModelIcon modelId={model.id} />
                <span className="flex-1 text-left">{model.name}</span>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

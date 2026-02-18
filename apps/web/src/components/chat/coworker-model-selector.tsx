"use client";

import { ChevronDown } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { type SyntheticEvent, useState } from "react";

import { getCoworkerImageUrl } from "@/app/chat/utils/coworker-utils";
import { getModelImageUrl } from "@/app/chat/utils/model-utils";
import type { Coworker } from "@/app/chat/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Model {
  id: string;
  name: string;
  icon?: React.ReactNode;
}

interface CoworkerModelSelectorProps {
  selectedCoworker: Coworker | null;
  selectedModel?: Model | null;
  coworkers?: Coworker[];
  onSelectCoworker: (coworker: Coworker) => void;
  onSelectModel?: (model: Model | null) => void;
  disabled?: boolean;
}

function ModelIcon({
  modelId,
  className,
}: {
  modelId: string;
  className?: string;
}) {
  const imageUrls = getModelImageUrl(modelId);

  if (!imageUrls) {
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
      <Image
        src={imageUrls.light}
        alt=""
        width={24}
        height={24}
        className="block size-full object-contain dark:hidden"
        onError={(e: SyntheticEvent<HTMLImageElement, Event>) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <Image
        src={imageUrls.dark}
        alt=""
        width={24}
        height={24}
        className="hidden size-full object-contain dark:block"
        onError={(e: SyntheticEvent<HTMLImageElement, Event>) => {
          e.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}

export default function CoworkerModelSelector({
  selectedCoworker,
  selectedModel,
  coworkers: propCoworkers,
  onSelectCoworker,
  onSelectModel,
  disabled = false,
}: CoworkerModelSelectorProps) {
  const t = useTranslations("App.Chat.Chat");
  const [open, setOpen] = useState(false);

  const coworkersFallback: Coworker[] = [
    {
      id: "hannah",
      name: t("coworkers.hannah.name"),
      description: t("coworkers.hannah.description"),
      useCase: t("coworkers.hannah.useCase"),
    },
    {
      id: "demosthenes",
      name: t("coworkers.demosthenes.name"),
      description: t("coworkers.demosthenes.description"),
      useCase: t("coworkers.demosthenes.useCase"),
    },
  ];
  const coworkers = propCoworkers?.length ? propCoworkers : coworkersFallback;

  const COMING_SOON_COWORKER_ID = "demosthenes";

  const models: Model[] = [
    { id: "gpt-4o-mini", name: t("modelNames.gpt4oMini") },
    { id: "gpt4o", name: t("modelNames.gpt4o") },
    { id: "gemini-2.0-flash", name: t("modelNames.gemini20Flash") },
    { id: "gemini-2.5-pro", name: t("modelNames.gemini25Pro") },
    { id: "mixtral-8x22b", name: t("modelNames.mixtral8x22b") },
    { id: "mixtral-8x7b", name: t("modelNames.mixtral8x7b") },
  ];

  const getCoworkerAvatarUrl = (c: Coworker): string | null =>
    getCoworkerImageUrl(c.id, c.avatar ?? undefined);

  // Prefer coworker from list (has avatar after API load) for display when ids match
  const displayCoworker =
    selectedCoworker &&
    (coworkers.find(
      (c) =>
        c.id === selectedCoworker.id ||
        c.slug === selectedCoworker.slug ||
        c.slug === selectedCoworker.id ||
        c.id === selectedCoworker.slug,
    ) ??
      selectedCoworker);

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
          ) : selectedCoworker ? (
            <>
              <Avatar className="size-5 shrink-0">
                <AvatarImage
                  src={
                    (displayCoworker &&
                      getCoworkerAvatarUrl(displayCoworker)) ??
                    undefined
                  }
                  alt={selectedCoworker.name}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {selectedCoworker.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="hidden sm:inline">{selectedCoworker.name}</span>
            </>
          ) : (
            <>
              <Avatar className="size-5 shrink-0">
                <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                  ?
                </AvatarFallback>
              </Avatar>
              <span className="text-muted-foreground hidden text-sm sm:inline">
                {t("selectCoworker.placeholder")}
              </span>
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
              {t("agenticCoworkers")}
            </h3>
          </div>
          <div className="px-1 pb-2">
            {coworkers.map((coworker) => {
              const isComingSoon = coworker.id === COMING_SOON_COWORKER_ID;
              return (
                <button
                  key={coworker.id}
                  type="button"
                  disabled={isComingSoon}
                  onClick={() =>
                    !isComingSoon && handleCoworkerSelect(coworker)
                  }
                  className={cn(
                    "hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm transition-colors",
                    selectedCoworker?.id === coworker.id && "bg-accent",
                    isComingSoon &&
                      "cursor-not-allowed opacity-60 hover:bg-transparent hover:opacity-60",
                  )}
                >
                  <Avatar className="size-6 shrink-0">
                    <AvatarImage
                      src={getCoworkerAvatarUrl(coworker) ?? undefined}
                      alt={coworker.name}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {coworker.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 text-left">{coworker.name}</span>
                  {isComingSoon && (
                    <span className="text-muted-foreground text-xs">
                      ({t("comingSoon")})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Models Section */}
          <div className="border-t px-3 pt-3 pb-2">
            <h3 className="text-foreground text-xs font-semibold">
              {t("models")}
            </h3>
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

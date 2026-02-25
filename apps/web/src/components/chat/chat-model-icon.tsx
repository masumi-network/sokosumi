"use client";

import { ModelIcon } from "@lobehub/icons";

import { cn } from "@/lib/utils";

interface ChatModelIconProps {
  modelId: string;
  modelName?: string;
  className?: string;
  size?: number;
}

function inferModel(modelId: string): string | null {
  if (modelId.includes("/")) {
    const [, model] = modelId.split("/");
    return model ?? null;
  }

  if (modelId.trim().length > 0) return modelId;

  return null;
}

export function ChatModelIcon({
  modelId,
  modelName,
  className,
  size = 16,
}: ChatModelIconProps) {
  const lobeModelId = inferModel(modelId);

  if (lobeModelId) {
    return (
      <ModelIcon
        model={lobeModelId}
        type="mono"
        size={size}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn(
        "bg-primary text-primary-foreground flex items-center justify-center rounded-full text-xs",
        className,
      )}
    >
      {(modelName ?? "M").charAt(0).toUpperCase()}
    </div>
  );
}

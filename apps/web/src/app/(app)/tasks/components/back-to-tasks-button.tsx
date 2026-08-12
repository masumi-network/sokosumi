"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { useMountEffect } from "@/hooks/use-mount-effect";

import { getStoredTasksReturnPath } from "./task-navigation";
import { useTasksReturnPath } from "./use-tasks-return-path";

interface BackToTasksButtonProps {
  label: string;
}

export function BackToTasksButton({ label }: BackToTasksButtonProps) {
  const router = useRouter();
  const returnPath = useTasksReturnPath();

  useMountEffect(() => {
    router.prefetch(getStoredTasksReturnPath());
  });

  const handleNavigate = () => {
    router.push(getStoredTasksReturnPath());
  };

  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground hidden items-center gap-1.5 text-sm transition-colors md:inline-flex"
      onClick={handleNavigate}
      onPointerEnter={() => router.prefetch(returnPath)}
      onFocus={() => router.prefetch(returnPath)}
    >
      <ArrowLeft className="size-4" />
      <span>{label}</span>
    </button>
  );
}

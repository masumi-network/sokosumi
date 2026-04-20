"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getNextTaskId } from "./task-navigation";

interface NextTaskButtonProps {
  currentTaskId: string;
  label: string;
}

export function NextTaskButton({ currentTaskId, label }: NextTaskButtonProps) {
  const router = useRouter();
  const [nextTaskId, setNextTaskId] = useState<string | null>(null);

  useEffect(() => {
    const nextId = getNextTaskId(currentTaskId);
    setNextTaskId(nextId);
    if (nextId) {
      router.prefetch(`/tasks/${nextId}`);
    }
  }, [currentTaskId, router]);

  if (!nextTaskId) return null;

  const handleNavigate = () => {
    router.push(`/tasks/${nextTaskId}`);
  };

  return (
    <>
      <span className="text-muted-foreground/40 text-sm">|</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
        onClick={handleNavigate}
        onPointerEnter={() => router.prefetch(`/tasks/${nextTaskId}`)}
        onFocus={() => router.prefetch(`/tasks/${nextTaskId}`)}
      >
        <span>{label}</span>
        <ArrowRight className="size-4" />
      </button>
    </>
  );
}

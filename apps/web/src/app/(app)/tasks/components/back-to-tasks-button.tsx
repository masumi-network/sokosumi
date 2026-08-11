"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getStoredTasksReturnPath } from "./task-navigation";

interface BackToTasksButtonProps {
  label: string;
}

export function BackToTasksButton({ label }: BackToTasksButtonProps) {
  const router = useRouter();
  const [returnPath, setReturnPath] = useState("/tasks");

  useEffect(() => {
    const nextReturnPath = getStoredTasksReturnPath();
    setReturnPath(nextReturnPath);
    router.prefetch(nextReturnPath);
  }, [router]);

  const handleNavigate = () => {
    router.push(returnPath);
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

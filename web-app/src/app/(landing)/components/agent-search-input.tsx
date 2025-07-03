"use client";

import { ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";

import { Input } from "@/components/ui/input";
import { useAsyncRouter } from "@/hooks/use-async-router";
import { cn } from "@/lib/utils";

interface AgentSearchInputProps {
  className?: string;
}

export default function AgentSearchInput({ className }: AgentSearchInputProps) {
  const t = useTranslations("Landing.Page.Hero.AgentSearchInput");
  const router = useAsyncRouter();
  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    await router.push(`/agents`);
  };

  return (
    <>
      <form
        onClick={handleSubmit}
        className={cn(
          "bg-background hover:bg-background/80 max-w-sm cursor-pointer rounded-md transition-colors",
          className,
        )}
      >
        <div className="relative">
          <Input
            type="text"
            placeholder={t("placeholder")}
            className="border-border cursor-pointer pr-12"
            readOnly
          />
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
            <div className="bg-border flex h-7 w-7 items-center justify-center rounded-md">
              <ArrowUp className="text-muted-foreground h-4 w-4" />
            </div>
          </div>
        </div>
      </form>
    </>
  );
}

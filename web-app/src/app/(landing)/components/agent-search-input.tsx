"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AgentSearchInputProps {
  className?: string;
}

export default function AgentSearchInput({ className }: AgentSearchInputProps) {
  const t = useTranslations("Landing.Page.Hero.AgentSearchInput");
  const router = useRouter();
  const handleSubmit = () => {
    router.push(`/agents`);
  };

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className={cn("bg-search-background max-w-sm rounded-md", className)}
      >
        <div className="relative">
          <Input
            type="text"
            placeholder={t("placeholder")}
            className="border-search-border pr-12"
          />
          <div className="absolute inset-y-0 right-2 flex items-center">
            <div className="bg-search-border flex h-7 w-7 items-center justify-center rounded-md">
              <ArrowUp className="text-muted-foreground h-4 w-4" />
            </div>
          </div>
        </div>
      </form>
    </>
  );
}

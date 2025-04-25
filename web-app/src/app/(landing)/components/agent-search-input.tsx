"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentSearchInputProps {
  className?: string;
}

export default function AgentSearchInput({ className }: AgentSearchInputProps) {
  const t = useTranslations("Landing.Page.Hero.AgentSearchInput");
  const router = useRouter();
  const handleClick = () => {
    router.push(`/agents`);
  };

  return (
    <>
      <div className={cn("relative", className)}>
        <Button
          variant="ghost"
          onClick={handleClick}
          size="lg"
          className="border-search-border bg-search-background text-muted-foreground rounded-lg border"
        >
          <ArrowUp className="h-4 w-4" />
          <span className="mr-auto">{t("placeholder")}</span>
        </Button>
      </div>
    </>
  );
}

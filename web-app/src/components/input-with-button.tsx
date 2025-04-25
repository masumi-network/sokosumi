"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function InputWithButton() {
  const t = useTranslations("Landing.Page.Hero.AgentSearchInput");
  const router = useRouter();
  const handleClick = () => {
    router.push(`/agents`);
  };

  return (
    <div className="bg-input-background border-input-border flex h-12 w-56 items-center rounded-lg border">
      <div className="relative flex-1">
        <Input
          type="text"
          placeholder={t("placeholder")}
          onClick={handleClick}
          className={cn(
            "h-full w-full border-none pr-12 focus-visible:ring-0 focus-visible:ring-offset-0",
            "text-muted-foreground placeholder:text-muted-foreground",
          )}
        />
        <Button
          onClick={handleClick}
          size="icon"
          className="background-input-border border-radius-md absolute top-1/2 right-1 h-8 w-8 -translate-y-1/2 opacity-50"
          aria-label="Submit"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";

import { Button } from "@/components/ui/button";

export default function InputWithButton() {
  const t = useTranslations("Landing.Page.Hero.AgentSearchInput");
  const router = useRouter();
  const handleClick = () => {
    router.push(`/agents`);
  };

  return (
    <>
      <Button
        onClick={handleClick}
        size="lg"
        className="flex items-center justify-between gap-2 rounded-lg"
      >
        <span className="text-muted-foreground">{t("placeholder")}</span>
        <div className="bg-secondary rounded-md p-1">
          <ArrowUp className="h-4 w-4" />
        </div>
      </Button>
    </>
  );
}

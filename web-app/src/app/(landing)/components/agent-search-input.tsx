import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface AgentSearchInputProps {
  className?: string;
}

export default function AgentSearchInput({ className }: AgentSearchInputProps) {
  const t = useTranslations("Landing.Page.Hero.AgentSearchInput");

  return (
    <Link
      href="/agents"
      className={cn(
        "border-senary bg-material-regular relative flex max-w-sm items-center rounded-xl border p-2 transition-all hover:opacity-80",
        className,
      )}
    >
      <Input
        id="search-input"
        type="text"
        placeholder={t("placeholder")}
        className="bg-material-regular! text-muted-foreground! border-none shadow-none focus-visible:ring-0"
        readOnly
      />
      <Button variant="outline" size="icon">
        <ArrowUp className="text-muted-foreground h-4 w-4" />
      </Button>
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

interface AgentCardButtonProps {
  agentId: string;
}

export default function AgentCardButton({ agentId }: AgentCardButtonProps) {
  const t = useTranslations("Components.Agents.AgentCard");
  let pathname = usePathname();

  if (pathname === "/") {
    pathname = "agents";
  }

  return (
    <Link href={`${pathname}/${agentId}`}>
      <Button>{t("button")}</Button>
    </Link>
  );
}

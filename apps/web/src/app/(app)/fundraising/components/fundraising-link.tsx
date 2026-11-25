"use client";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useFundraisingAccess } from "../use-fundraising";

/** A way into the raise, shown only where the organization has one. */
export function FundraisingLink({ className }: { className?: string }) {
  const t = useTranslations("App.Fundraising");
  const enabled = useFundraisingAccess();
  if (!enabled) return null;
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <Link href="/fundraising" data-testid="fundraising-link">
        {t("link")}
        <ArrowUpRight aria-hidden className="size-4" />
      </Link>
    </Button>
  );
}

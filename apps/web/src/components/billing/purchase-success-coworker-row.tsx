"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense, use } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

interface PurchaseSuccessCoworkerRowProps {
  coworkersPromise: Promise<CoworkerOption[]>;
  className?: string;
}

export function PurchaseSuccessCoworkerRow(
  props: PurchaseSuccessCoworkerRowProps,
) {
  return (
    <Suspense fallback={<CoworkerRowLoading />}>
      <CoworkerRowInner {...props} />
    </Suspense>
  );
}

function CoworkerRowInner({
  coworkersPromise,
  className,
}: PurchaseSuccessCoworkerRowProps) {
  const t = useTranslations("App.Billing.PurchaseSuccess");
  const coworkers = use(coworkersPromise);

  if (coworkers.length === 0) {
    return (
      <Button asChild variant="outline" className={className}>
        <Link href="/tasks">
          {t("goToTasks")}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    );
  }

  return (
    <div className={cn("flex justify-center gap-6", className)}>
      {coworkers.map((coworker) => (
        <Link
          key={coworker.id}
          href={`/tasks?create=true&assignee=${encodeURIComponent(coworker.slug)}`}
          aria-label={t("startTaskWith", { name: coworker.name })}
          className="group focus-visible:ring-ring flex flex-col items-center gap-2 rounded-lg p-1 outline-none focus-visible:ring-2"
        >
          <Avatar className="ring-border group-hover:ring-primary size-14 ring-1 transition-all group-hover:scale-105 group-hover:ring-2">
            <AvatarImage src={coworker.image} alt="" className="object-cover" />
            <AvatarFallback className="text-sm font-medium">
              {coworker.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-foreground text-sm font-medium">
            {coworker.name}
          </span>
          <span className="text-muted-foreground group-hover:text-primary text-xs transition-colors">
            {t("startTask")}
          </span>
        </Link>
      ))}
    </div>
  );
}

function CoworkerRowLoading() {
  return (
    <div className="flex justify-center gap-6" aria-hidden>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex flex-col items-center gap-2 p-1">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-3.5 w-12 rounded-full" />
          <Skeleton className="h-3 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

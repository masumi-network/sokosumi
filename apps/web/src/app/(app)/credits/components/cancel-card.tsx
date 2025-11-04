"use client";

import { X, XCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface CancelCardProps {
  className?: string;
}

export default function CancelCard({ className }: CancelCardProps) {
  const t = useTranslations("App.Credits.Cancel");

  return (
    <Card className={cn("text-center", className)}>
      <CardHeader>
        <div className="absolute top-2 right-2">
          <DialogClose asChild>
            <Button variant="ghost" size="icon">
              <X />
            </Button>
          </DialogClose>
        </div>
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
          <XCircle className="size-6 text-red-600 dark:text-red-400" />
        </div>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/credits">{t("backToCredits")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { CoworkerDisplayForm } from "@/components/coworkers/coworker-display-form";
import { updateDeveloperCoworkerDisplayAction } from "@/lib/actions/coworkers/update-display.action";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

interface DeveloperCoworkerEditFormProps {
  coworker: Coworker;
}

export function DeveloperCoworkerEditForm({
  coworker,
}: DeveloperCoworkerEditFormProps) {
  const t = useTranslations("App.Developer.Coworkers");
  const router = useRouter();

  function handleNotFound() {
    toast.error(t("errors.notFound"));
    router.push("/developer?tab=coworkers");
  }

  return (
    <CoworkerDisplayForm
      coworker={coworker}
      cancelHref="/developer?tab=coworkers"
      updateAction={updateDeveloperCoworkerDisplayAction}
      onNotFound={handleNotFound}
    />
  );
}

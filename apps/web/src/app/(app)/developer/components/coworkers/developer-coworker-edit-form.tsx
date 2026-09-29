"use client";

import type { Coworker } from "@sokosumi/core-client";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CoworkerDisplayForm } from "@/components/coworkers/coworker-display-form";
import { updateDeveloperCoworkerDisplayAction } from "@/lib/actions/coworkers/update-display.action";

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
    router.push("/developer/coworkers");
  }

  return (
    <CoworkerDisplayForm
      coworker={coworker}
      cancelHref="/developer/coworkers"
      updateAction={updateDeveloperCoworkerDisplayAction}
      onNotFound={handleNotFound}
    />
  );
}

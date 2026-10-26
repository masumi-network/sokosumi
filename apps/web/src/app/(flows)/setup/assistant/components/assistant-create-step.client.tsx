"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CreateState } from "@/app/personal-assistant/components/create-state.client";
import { Button } from "@/components/ui/button";

interface AssistantCreateStepProps {
  paidByOrganization: boolean;
  /** Where "Later" goes: the page setup was heading to. */
  laterUrl: string;
  /** The optional connect step that follows a created bot. */
  connectUrl: string;
}

/** The regular Soko Bot create form, with a way to skip it. */
export function AssistantCreateStep({
  paidByOrganization,
  laterUrl,
  connectUrl,
}: AssistantCreateStepProps) {
  const t = useTranslations("WorkspaceGate.Assistant");
  const router = useRouter();

  return (
    <CreateState
      paidByOrganization={paidByOrganization}
      onCreated={() => router.replace(connectUrl)}
      secondaryAction={
        <Button asChild variant="ghost" className="w-full">
          <Link href={laterUrl} replace>
            {t("later")}
          </Link>
        </Button>
      }
    />
  );
}

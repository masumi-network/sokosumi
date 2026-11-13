"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportAdminAdEvals } from "@/lib/actions/admin-ad-evals/action";

export function ExportAdEvalsButton() {
  const t = useTranslations("App.Admin.AdEvals.Export");
  const [pending, startTransition] = useTransition();

  function handleExport() {
    startTransition(async () => {
      try {
        const result = await exportAdminAdEvals({});
        if (!result.ok) {
          toast.error(t("error"));
          return;
        }
        const url = URL.createObjectURL(
          new Blob([result.value], { type: "application/x-ndjson" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "ad-evals.jsonl";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        toast.error(t("error"));
      }
    });
  }

  return (
    <Button
      onClick={handleExport}
      loading={pending}
      disabled={pending}
      size="sm"
    >
      <Download />
      {t("download")}
    </Button>
  );
}

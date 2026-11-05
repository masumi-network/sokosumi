"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { seoPageChangeBody } from "./seo-page-change-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function useSeoPageChange(model: SeoWorkspaceModel) {
  const t = useTranslations("App.Seo");
  const [workspace] = useState(() => model.data);
  const [timeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  async function submit(form: FormData) {
    try {
      const body = seoPageChangeBody(form, workspace);
      await model.execute(
        {
          kind: "record_page_change",
          body: {
            ...body,
            idempotencyKey: model.operationKey(
              `page-change:${JSON.stringify(body)}`,
            ),
          },
        },
        t("pageChange.recorded"),
      );
    } catch {
      toast.error(t("pageChange.invalid"));
    }
  }
  return { workspace, timeZone, submit };
}

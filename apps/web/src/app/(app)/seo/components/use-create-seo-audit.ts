"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { createSeoAuditAction } from "@/lib/actions/seo/create-audit";

export function useCreateSeoAudit() {
  const router = useRouter();
  const t = useTranslations("App.Seo");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  async function submit(form: FormData) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await createSeoAuditAction({
        body: {
          name: String(form.get("name") ?? "").trim(),
          firstPage: { url: String(form.get("url") ?? "").trim() },
        },
      });
      if (!result.ok || !result.value.auditId) {
        setError(t("audits.createFailed"));
        return;
      }
      router.push(`/seo?auditId=${encodeURIComponent(result.value.auditId)}`);
      setOpen(false);
    } catch {
      setError(t("audits.createFailed"));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return { open, setOpen, pending, error, submit };
}

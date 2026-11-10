"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { createSeoAuditAction } from "@/lib/actions/seo/create-audit";
import { seoAuditHref, seoIndexHref } from "../seo-href";
import { seoAuditName } from "./seo-audit-name";

/** A new Audit links to the header's Project scope when one is chosen. */
export function useCreateSeoAudit(
  projectId: string | null,
  initialOpen = false,
) {
  const router = useRouter();
  const t = useTranslations("App.Seo");
  const [open, setOpenState] = useState(initialOpen);
  function setOpen(next: boolean) {
    setOpenState(next);
    // The link's request for the form is done: a reload must not open it again.
    if (!next && initialOpen) router.replace(seoIndexHref(projectId));
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  async function submit(form: FormData) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const url = String(form.get("url") ?? "").trim();
      const result = await createSeoAuditAction({
        body: {
          name: seoAuditName(String(form.get("name") ?? ""), url),
          firstPage: { url },
          ...(projectId ? { projectId } : {}),
        },
      });
      if (!result.ok || !result.value.auditId) {
        setError(t("audits.createFailed"));
        return;
      }
      router.push(seoAuditHref(result.value.auditId, projectId));
      // Not `setOpen`: the address now belongs to the new Audit.
      setOpenState(false);
    } catch {
      setError(t("audits.createFailed"));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return { open, setOpen, pending, error, submit };
}

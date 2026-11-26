"use client";

import { normalizeWebsiteUrl } from "@sokosumi/utils";
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
  // One key per input for the life of the form: a retry of input A replays A's first create, also after a try of
  // input B in between (its response may have been lost after Core made the Audit). Other input gets a new key.
  const keysRef = useRef(new Map<string, string>());
  async function submit(form: FormData) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const typed = String(form.get("url") ?? "").trim();
      // "example.com" means https://example.com/; Core checks the rest.
      const url = normalizeWebsiteUrl(typed) ?? typed;
      const request = {
        name: seoAuditName(String(form.get("name") ?? ""), url),
        firstPage: { url },
        ...(projectId ? { projectId } : {}),
      };
      const signature = JSON.stringify(request);
      const key = keysRef.current.get(signature) ?? crypto.randomUUID();
      keysRef.current.set(signature, key);
      const result = await createSeoAuditAction({
        body: { ...request, idempotencyKey: key },
      });
      if (!result.ok || !result.value.auditId) {
        setError(t("audits.createFailed"));
        return;
      }
      keysRef.current.delete(signature);
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

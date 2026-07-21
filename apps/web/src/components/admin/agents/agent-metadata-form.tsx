"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteAdminAgentMetadataOverrideAction,
  patchAdminAgentMetadataOverrideAction,
} from "@/lib/actions/admin-agents/action";
import type {
  AdminAgentDetail,
  AdminAgentMetadataOverrideExample,
  PatchAdminAgentMetadataOverrideBody,
} from "@/lib/clients/generated/core";

interface AgentMetadataFormProps {
  agentId: string;
  detail: AdminAgentDetail;
}

interface OverrideFormState {
  name: string;
  description: string;
  apiBaseUrl: string;
  image: string;
  authorName: string;
  authorImage: string;
  authorContactEmail: string;
  authorContactOther: string;
  authorOrganization: string;
  legalPrivacyPolicy: string;
  legalDpa: string;
  legalTerms: string;
  legalOther: string;
  tags: string;
  examples: string;
}

type ScalarField = Exclude<keyof OverrideFormState, "tags" | "examples">;

/** Two-column pairs keep the grid even; full-width fields use col-span-2. */
const OVERRIDE_FIELD_LAYOUT: Array<
  | { kind: "full"; field: ScalarField }
  | { kind: "pair"; fields: [ScalarField, ScalarField] }
> = [
  { kind: "full", field: "name" },
  { kind: "full", field: "description" },
  { kind: "pair", fields: ["image", "apiBaseUrl"] },
  { kind: "pair", fields: ["authorName", "authorImage"] },
  { kind: "pair", fields: ["authorContactEmail", "authorContactOther"] },
  { kind: "full", field: "authorOrganization" },
  { kind: "pair", fields: ["legalPrivacyPolicy", "legalDpa"] },
  { kind: "pair", fields: ["legalTerms", "legalOther"] },
];

function toFormState(detail: AdminAgentDetail): OverrideFormState {
  const override = detail.override;
  return {
    name: override?.name ?? "",
    description: override?.description ?? "",
    apiBaseUrl: override?.apiBaseUrl ?? "",
    image: override?.image ?? "",
    authorName: override?.authorName ?? "",
    authorImage: override?.authorImage ?? "",
    authorContactEmail: override?.authorContactEmail ?? "",
    authorContactOther: override?.authorContactOther ?? "",
    authorOrganization: override?.authorOrganization ?? "",
    legalPrivacyPolicy: override?.legalPrivacyPolicy ?? "",
    legalDpa: override?.legalDpa ?? "",
    legalTerms: override?.legalTerms ?? "",
    legalOther: override?.legalOther ?? "",
    tags: override?.tags.join(", ") ?? "",
    examples: (override?.exampleOutputs ?? [])
      .map((example) => `${example.name}|${example.mimeType}|${example.url}`)
      .join("\n"),
  };
}

function parseExamples(
  raw: string,
): AdminAgentMetadataOverrideExample[] | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const examples: AdminAgentMetadataOverrideExample[] = [];
  for (const line of lines) {
    const [name, mimeType, url] = line.split("|").map((part) => part.trim());
    if (!name || !mimeType || !url) {
      return null;
    }
    examples.push({ name, mimeType, url });
  }
  return examples;
}

function optionalField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function buildPatchBody(
  form: OverrideFormState,
): PatchAdminAgentMetadataOverrideBody {
  const examples = parseExamples(form.examples);
  return {
    name: optionalField(form.name),
    description: optionalField(form.description),
    apiBaseUrl: optionalField(form.apiBaseUrl),
    image: optionalField(form.image),
    authorName: optionalField(form.authorName),
    authorImage: optionalField(form.authorImage),
    authorContactEmail: optionalField(form.authorContactEmail),
    authorContactOther: optionalField(form.authorContactOther),
    authorOrganization: optionalField(form.authorOrganization),
    legalPrivacyPolicy: optionalField(form.legalPrivacyPolicy),
    legalDpa: optionalField(form.legalDpa),
    legalTerms: optionalField(form.legalTerms),
    legalOther: optionalField(form.legalOther),
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    exampleOutputs: examples ?? [],
  };
}

export function AgentMetadataForm({ agentId, detail }: AgentMetadataFormProps) {
  const t = useTranslations("App.Admin.Agents.AgentDetail");
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(detail));
  const [resolved, setResolved] = useState(detail.resolved);
  const [hasOverride, setHasOverride] = useState(detail.override !== null);
  const [isPending, startTransition] = useTransition();

  function updateField<K extends keyof OverrideFormState>(
    key: K,
    value: OverrideFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSave() {
    const examples = parseExamples(form.examples);
    if (examples === null) {
      toast.error(t("examplesInvalid"));
      return;
    }

    startTransition(async () => {
      const result = await patchAdminAgentMetadataOverrideAction({
        agentId,
        body: buildPatchBody(form),
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("saveError"));
        return;
      }
      setForm(toFormState(result.data));
      setResolved(result.data.resolved);
      setHasOverride(result.data.override !== null);
      toast.success(t("saveSuccess"));
      router.refresh();
    });
  }

  function handleClearAll() {
    startTransition(async () => {
      const result = await deleteAdminAgentMetadataOverrideAction({ agentId });
      if (!result.ok) {
        toast.error(result.error.message ?? t("clearError"));
        return;
      }
      setForm(toFormState(result.data));
      setHasOverride(false);
      setResolved(result.data.resolved);
      toast.success(t("clearSuccess"));
      router.refresh();
    });
  }

  function renderScalarField(field: ScalarField) {
    return (
      <div key={field} className="space-y-2">
        <Label htmlFor={field}>{t(`fields.${field}`)}</Label>
        {field === "description" ? (
          <Textarea
            id={field}
            value={form[field]}
            onChange={(event) => updateField(field, event.target.value)}
            disabled={isPending}
            rows={4}
          />
        ) : (
          <Input
            id={field}
            value={form[field]}
            onChange={(event) => updateField(field, event.target.value)}
            disabled={isPending}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("registryTitle")}</h2>
        <div className="bg-muted/40 grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-muted-foreground">{t("registryName")}</p>
            <p>{detail.registry.name}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">{t("blockchainIdentifier")}</p>
            <p className="break-all font-mono text-xs">
              {detail.registry.blockchainIdentifier}
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-muted-foreground">{t("registryDescription")}</p>
            <p>{detail.registry.description ?? t("emptyValue")}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t("overrideTitle")}</h2>
            <p className="text-muted-foreground text-sm">
              {t("overrideDescription")}
            </p>
          </div>
          <p className="text-muted-foreground text-sm">
            {hasOverride ? t("hasOverride") : t("noOverride")}
          </p>
        </div>

        <div className="space-y-4 rounded-md border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {OVERRIDE_FIELD_LAYOUT.flatMap((row) => {
              if (row.kind === "full") {
                return [
                  <div key={row.field} className="sm:col-span-2">
                    {renderScalarField(row.field)}
                  </div>,
                ];
              }

              return row.fields.map((field) => renderScalarField(field));
            })}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tags">{t("fields.tags")}</Label>
              <Input
                id="tags"
                value={form.tags}
                placeholder={t("fields.tagsPlaceholder")}
                onChange={(event) => updateField("tags", event.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="examples">{t("fields.examples")}</Label>
              <Textarea
                id="examples"
                value={form.examples}
                placeholder={t("fields.examplesPlaceholder")}
                onChange={(event) =>
                  updateField("examples", event.target.value)
                }
                disabled={isPending}
                rows={4}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 border-t pt-4">
            <Button onClick={handleSave} disabled={isPending}>
              {t("save")}
            </Button>
            <Button
              variant="outline"
              onClick={handleClearAll}
              disabled={isPending || !hasOverride}
            >
              {t("clearAll")}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("resolvedTitle")}</h2>
        <div className="grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-muted-foreground">{t("fields.name")}</p>
            <p>{resolved.name}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">{t("fields.apiBaseUrl")}</p>
            <p className="break-all">{resolved.apiBaseUrl}</p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <p className="text-muted-foreground">{t("fields.description")}</p>
            <p>{resolved.description ?? t("emptyValue")}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">{t("fields.image")}</p>
            <p className="break-all">{resolved.image ?? t("emptyValue")}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">{t("fields.tags")}</p>
            <p>
              {resolved.tags.length > 0
                ? resolved.tags.join(", ")
                : t("emptyValue")}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

"use client";

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
  tags: string;
  examples: string;
}

function toFormState(detail: AdminAgentDetail): OverrideFormState {
  const override = detail.override;
  return {
    name: override?.name ?? "",
    description: override?.description ?? "",
    apiBaseUrl: override?.apiBaseUrl ?? "",
    image: override?.image ?? "",
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

function buildPatchBody(
  form: OverrideFormState,
): PatchAdminAgentMetadataOverrideBody {
  const examples = parseExamples(form.examples);
  return {
    name: form.name.trim() === "" ? null : form.name.trim(),
    description:
      form.description.trim() === "" ? null : form.description.trim(),
    apiBaseUrl: form.apiBaseUrl.trim() === "" ? null : form.apiBaseUrl.trim(),
    image: form.image.trim() === "" ? null : form.image.trim(),
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    exampleOutputs: examples ?? [],
  };
}

export function AgentMetadataForm({ agentId, detail }: AgentMetadataFormProps) {
  const t = useTranslations("App.Admin.Agents.AgentDetail");
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
    });
  }

  function handleClearAll() {
    startTransition(async () => {
      const result = await deleteAdminAgentMetadataOverrideAction({ agentId });
      if (!result.ok) {
        toast.error(result.error.message ?? t("clearError"));
        return;
      }
      setForm({
        name: "",
        description: "",
        apiBaseUrl: "",
        image: "",
        tags: "",
        examples: "",
      });
      setHasOverride(false);
      setResolved(result.data.resolved);
      toast.success(t("clearSuccess"));
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("registryTitle")}</h2>
        <div className="bg-muted/40 grid gap-3 rounded-md border p-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">{t("registryName")}</p>
            <p>{detail.registry.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("blockchainIdentifier")}</p>
            <p className="break-all">{detail.registry.blockchainIdentifier}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-muted-foreground">{t("registryDescription")}</p>
            <p>{detail.registry.description ?? t("emptyValue")}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("overrideTitle")}</h2>
            <p className="text-muted-foreground text-sm">
              {t("overrideDescription")}
            </p>
          </div>
          {hasOverride ? (
            <Button
              variant="destructive"
              onClick={handleClearAll}
              disabled={isPending}
            >
              {t("clearAll")}
            </Button>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="override-name">{t("fields.name")}</Label>
            <Input
              id="override-name"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="override-image">{t("fields.image")}</Label>
            <Input
              id="override-image"
              value={form.image}
              onChange={(event) => updateField("image", event.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="override-description">
              {t("fields.description")}
            </Label>
            <Textarea
              id="override-description"
              value={form.description}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="override-api-base-url">
              {t("fields.apiBaseUrl")}
            </Label>
            <Input
              id="override-api-base-url"
              value={form.apiBaseUrl}
              onChange={(event) =>
                updateField("apiBaseUrl", event.target.value)
              }
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="override-tags">{t("fields.tags")}</Label>
            <Input
              id="override-tags"
              value={form.tags}
              onChange={(event) => updateField("tags", event.target.value)}
              placeholder={t("fields.tagsPlaceholder")}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="override-examples">{t("fields.examples")}</Label>
            <Textarea
              id="override-examples"
              value={form.examples}
              onChange={(event) => updateField("examples", event.target.value)}
              placeholder={t("fields.examplesPlaceholder")}
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={isPending}>
          {t("save")}
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("resolvedTitle")}</h2>
        <div className="bg-muted/40 grid gap-3 rounded-md border p-4 text-sm md:grid-cols-2">
          <div>
            <p className="text-muted-foreground">{t("fields.name")}</p>
            <p>{resolved.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("fields.apiBaseUrl")}</p>
            <p className="break-all">{resolved.apiBaseUrl}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-muted-foreground">{t("fields.description")}</p>
            <p>{resolved.description ?? t("emptyValue")}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-muted-foreground">{t("fields.tags")}</p>
            <p>{resolved.tags.join(", ") || t("emptyValue")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

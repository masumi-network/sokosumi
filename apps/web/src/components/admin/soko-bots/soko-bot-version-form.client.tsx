"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createAdminSokoBotVersionAction,
  updateAdminSokoBotVersionAction,
} from "@/lib/actions/admin-soko-bots/action";
import type {
  SokoBotGatewayModel,
  SokoBotVersionDetail,
  SokoBotVersionList,
} from "@/lib/clients/generated/core";
import { ADMIN_SOKO_BOT_VERSIONS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

interface VersionFormState {
  slug: string;
  name: string;
  summary: string;
  model: string;
  inferenceRegion: "eu" | "us" | null;
  systemPrompt: string;
  skills: string[];
  capabilities: string[];
}

interface SokoBotVersionFormProps {
  mode: "create" | "edit";
  initialVersion?: SokoBotVersionDetail | null;
  gatewayModels: SokoBotGatewayModel[];
  availableSkills: SokoBotVersionList["availableSkills"];
  availableCapabilities: string[];
}

function toFormState(
  mode: SokoBotVersionFormProps["mode"],
  version?: SokoBotVersionDetail | null,
): VersionFormState {
  return {
    slug: mode === "create" ? "" : (version?.id ?? ""),
    name: version?.name ?? "",
    summary: version?.summary ?? "",
    model: version?.model ?? "",
    inferenceRegion:
      version?.inferenceRegion === "eu" || version?.inferenceRegion === "us"
        ? version.inferenceRegion
        : null,
    systemPrompt: version?.systemPrompt ?? "",
    skills: [...(version?.skills ?? [])],
    capabilities: [...(version?.capabilities ?? [])],
  };
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function SokoBotVersionForm({
  mode,
  initialVersion,
  gatewayModels,
  availableSkills,
  availableCapabilities,
}: SokoBotVersionFormProps) {
  const t = useTranslations("App.Admin.SokoBots.Versions");
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(mode, initialVersion));
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function formatRegion(region: string): string {
    if (region === "eu") {
      return t("Values.eu");
    }
    if (region === "us") {
      return t("Values.us");
    }
    return region;
  }

  function updateField<K extends keyof VersionFormState>(
    key: K,
    value: VersionFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const input = {
        name: form.name,
        summary: form.summary,
        model: form.model,
        inferenceRegion: form.inferenceRegion,
        systemPrompt: form.systemPrompt,
        skills: form.skills,
        capabilities: form.capabilities,
      };
      const result =
        mode === "create"
          ? await createAdminSokoBotVersionAction({
              input: { slug: form.slug, ...input },
            })
          : await updateAdminSokoBotVersionAction({
              slug: form.slug,
              input,
            });
      if (!result.ok) {
        toast.error(t("Form.saveError"));
        return;
      }
      toast.success(t(mode === "create" ? "Form.created" : "Form.updated"));
      router.push(
        `${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${encodeURIComponent(result.value.id)}`,
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {mode === "create" && initialVersion ? (
        <div className="bg-muted/40 rounded-md border px-4 py-3 text-sm">
          {t("Form.duplicatedFrom", { version: initialVersion.name })}
        </div>
      ) : null}

      <div className="grid gap-5 rounded-lg border p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="version-slug">{t("Form.slug")}</Label>
          <Input
            id="version-slug"
            value={form.slug}
            onChange={(event) => updateField("slug", event.target.value)}
            disabled={mode === "edit" || isPending}
            required
            minLength={2}
            maxLength={41}
            pattern="[a-z0-9][a-z0-9-]*"
            autoComplete="off"
          />
          <p className="text-muted-foreground text-xs">{t("Form.slugHint")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="version-name">{t("Form.name")}</Label>
          <Input
            id="version-name"
            value={form.name}
            onChange={(event) => updateField("name", event.target.value)}
            disabled={isPending}
            required
            maxLength={120}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="version-summary">{t("Form.summary")}</Label>
          <Textarea
            id="version-summary"
            value={form.summary}
            onChange={(event) => updateField("summary", event.target.value)}
            disabled={isPending}
            maxLength={2_000}
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="version-model">{t("Form.model")}</Label>
          <div className="flex gap-2">
            <Input
              id="version-model"
              value={form.model}
              onChange={(event) => updateField("model", event.target.value)}
              disabled={isPending}
              required
              maxLength={200}
              autoComplete="off"
            />
            {gatewayModels.length > 0 ? (
              <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("Form.gatewayModels")}
                    disabled={isPending}
                  >
                    <ChevronsUpDown aria-hidden className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-[calc(100vw-2rem)] max-w-96 p-0"
                >
                  <Command>
                    <CommandInput placeholder={t("Form.searchModels")} />
                    <CommandList>
                      <CommandEmpty>{t("Form.noModelMatch")}</CommandEmpty>
                      <CommandGroup>
                        {gatewayModels.map((model) => (
                          <CommandItem
                            key={model.id}
                            value={`${model.id} ${model.name ?? ""} ${model.regions.join(" ")}`}
                            onSelect={() => {
                              updateField("model", model.id);
                              setModelPickerOpen(false);
                            }}
                          >
                            <Check
                              aria-hidden
                              className={cn(
                                "size-4",
                                form.model === model.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">
                                {model.name ?? model.id}
                              </span>
                              <span className="text-muted-foreground block truncate font-mono text-xs">
                                {model.id}
                              </span>
                            </span>
                            <span className="flex gap-1">
                              {model.regions.map((region) => (
                                <Badge key={region} variant="outline">
                                  {formatRegion(region)}
                                </Badge>
                              ))}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
          {gatewayModels.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("Form.noGatewayModels")}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="version-region">{t("Form.region")}</Label>
          <Select
            value={form.inferenceRegion ?? "none"}
            onValueChange={(value) =>
              updateField(
                "inferenceRegion",
                value === "eu" || value === "us" ? value : null,
              )
            }
            disabled={isPending}
          >
            <SelectTrigger id="version-region" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("Values.noRegion")}</SelectItem>
              <SelectItem value="eu">{t("Values.eu")}</SelectItem>
              <SelectItem value="us">{t("Values.us")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <section className="space-y-2">
        <div>
          <Label htmlFor="version-system-prompt">
            {t("Form.systemPrompt")}
          </Label>
          <p className="text-muted-foreground mt-1 text-xs">
            {t("Form.systemPromptHint")}
          </p>
        </div>
        <Textarea
          id="version-system-prompt"
          value={form.systemPrompt}
          onChange={(event) => updateField("systemPrompt", event.target.value)}
          disabled={isPending}
          required
          maxLength={60_000}
          className="min-h-[32rem] resize-y font-mono leading-relaxed"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">
            {t("Form.skills")}
          </legend>
          <p className="text-muted-foreground text-xs">
            {t("Form.skillsHint")}
          </p>
          <div className="space-y-2">
            {availableSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-start gap-3 rounded-md border p-3"
              >
                <Checkbox
                  id={`skill-${skill.id}`}
                  checked={form.skills.includes(skill.id)}
                  onCheckedChange={() =>
                    updateField(
                      "skills",
                      toggleSelection(form.skills, skill.id),
                    )
                  }
                  disabled={isPending}
                />
                <Label
                  htmlFor={`skill-${skill.id}`}
                  className="block min-w-0 cursor-pointer"
                >
                  <span className="block">{skill.name}</span>
                  <span className="text-muted-foreground mt-1 block text-xs font-normal leading-relaxed">
                    {skill.description}
                  </span>
                </Label>
              </div>
            ))}
            {availableSkills.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t("Form.noSkillsAvailable")}
              </p>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">
            {t("Form.tools")}
          </legend>
          <p className="text-muted-foreground text-xs">{t("Form.toolsHint")}</p>
          {form.capabilities.length === 0 ? (
            <div className="bg-muted/40 rounded-md border px-3 py-2 text-sm font-medium">
              {t("Form.allRouteTools")}
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {availableCapabilities.map((capability) => (
              <div
                key={capability}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <Checkbox
                  id={`capability-${capability}`}
                  checked={form.capabilities.includes(capability)}
                  onCheckedChange={() =>
                    updateField(
                      "capabilities",
                      toggleSelection(form.capabilities, capability),
                    )
                  }
                  disabled={isPending}
                />
                <Label
                  htmlFor={`capability-${capability}`}
                  className="cursor-pointer font-mono text-xs"
                >
                  {capability}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" asChild>
          <Link
            href={
              mode === "edit"
                ? `${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${encodeURIComponent(form.slug)}`
                : ADMIN_SOKO_BOT_VERSIONS_ROUTE
            }
          >
            {t("Actions.cancel")}
          </Link>
        </Button>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending
            ? t("Form.saving")
            : t(mode === "create" ? "Form.create" : "Form.save")}
        </Button>
      </div>
    </form>
  );
}

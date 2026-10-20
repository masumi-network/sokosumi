"use client";

import { SokoBotScope } from "@sokosumi/core-client";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { openNewSokoBotRoom } from "@/app/personal-assistant/components/open-new-soko-bot-room";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createScopedSokoBotAction } from "@/lib/actions/soko-bot/action";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";

export interface CreateSokoBotProject {
  id: string;
  name: string;
}

interface CreateSokoBotDialogProps {
  /** Offered only while the viewer has no bot of their own. */
  canCreatePersonal: boolean;
  projects: CreateSokoBotProject[];
  defaultScope: SokoBotScope;
  defaultProjectId?: string | null;
}

const NAME_MAX_LENGTH = 80;

/**
 * Creates a Soko Bot for the viewer, one project or the whole workspace. Core
 * decides who may create what; this form only collects the choice.
 */
export function CreateSokoBotDialog({
  canCreatePersonal,
  projects,
  defaultScope,
  defaultProjectId = null,
}: CreateSokoBotDialogProps) {
  const t = useTranslations("App.SokoBots.Shared.Create");
  const router = useRouter();
  const nameId = useId();
  const projectId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<SokoBotScope>(defaultScope);
  const [project, setProject] = useState<string | null>(defaultProjectId);
  const [pending, startTransition] = useTransition();
  const ready =
    name.trim().length > 0 &&
    (scope !== SokoBotScope.PROJECT || project !== null);

  function handleCreate() {
    startTransition(async () => {
      const result = await createScopedSokoBotAction({
        input: {
          name: name.trim(),
          scope,
          projectId: scope === SokoBotScope.PROJECT ? project : null,
          timezone: getDefaultTimezone(),
        },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("error"));
        return;
      }
      if (scope !== SokoBotScope.PERSONAL) {
        setOpen(false);
        toast.success(t("created"));
        router.push(sokoBotConsoleRoute(result.value.id));
        return;
      }
      // A personal bot opens in its direct room and says hello, as on the
      // assistant page.
      const roomId = await openNewSokoBotRoom(result.value.id);
      setOpen(false);
      toast.success(t("created"));
      router.push(
        roomId
          ? `/chat/rooms/${encodeURIComponent(roomId)}`
          : sokoBotConsoleRoute(null),
      );
    });
  }

  const scopes: SokoBotScope[] = canCreatePersonal
    ? [SokoBotScope.PERSONAL, SokoBotScope.PROJECT, SokoBotScope.WORKSPACE]
    : [SokoBotScope.PROJECT, SokoBotScope.WORKSPACE];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Plus aria-hidden className="size-4" />
          {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) handleCreate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={nameId}>{t("nameLabel")}</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("scopeLabel")}</legend>
            <RadioGroup
              value={scope}
              onValueChange={(value) => {
                const next = scopes.find((option) => option === value);
                if (next) setScope(next);
              }}
            >
              {scopes.map((option) => (
                <Label
                  key={option}
                  className="flex cursor-pointer items-start gap-3 font-normal"
                >
                  <RadioGroupItem value={option} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {t(`scopes.${option}.label`)}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {t(`scopes.${option}.hint`)}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </fieldset>
          {scope === SokoBotScope.PROJECT ? (
            <div className="space-y-2">
              <Label htmlFor={projectId}>{t("projectLabel")}</Label>
              <Select value={project ?? undefined} onValueChange={setProject}>
                <SelectTrigger id={projectId} className="w-full">
                  <SelectValue placeholder={t("projectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={!ready}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

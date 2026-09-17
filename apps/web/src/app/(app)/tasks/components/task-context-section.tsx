import {
  buildAdHocDesignMdPrefix,
  parseTaskContextFromDescription,
  type TaskContextSelectionSnapshot,
} from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";

import type { ProjectFilterOption } from "@/app/tasks/utils/tasks-filters";
import { getSession } from "@/lib/auth/auth.server";
import type { EffectiveDesignMdAttachment } from "@/lib/services/design-md.service";
import { designMdService } from "@/lib/services/design-md.service";

import {
  resolveBrandPillDisplay,
  StaticContextPill,
} from "./task-context-pill";

interface TaskContextSectionProps {
  description?: string | null;
  project?: ProjectFilterOption | null;
}

export async function TaskContextSection({
  description,
  project,
}: TaskContextSectionProps) {
  const session = await getSession();
  const defaultBrand = session?.user.id
    ? await designMdService.resolveEffectiveDesignMd()
    : null;

  const parsed = parseTaskContextFromDescription(description ?? "", {
    projectDesignMdUrl: project?.designMd?.url ?? null,
    workspaceDesignMdUrl: defaultBrand?.url ?? null,
    adHocPathPrefix: session?.user.id
      ? buildAdHocDesignMdPrefix(session.user.id)
      : null,
  });

  const [tDetail, tContext] = await Promise.all([
    getTranslations("App.Tasks.Detail"),
    getTranslations("App.Tasks.NewTask.ContextAttachments"),
  ]);

  return (
    <TaskContextSectionContent
      title={tDetail("context")}
      selection={parsed.selection}
      project={project}
      defaultBrand={defaultBrand}
      labels={{
        briefing: tContext("briefing"),
        memory: tContext("memory"),
        brand: tContext("brand"),
        namedBrand: (values) => tContext("namedBrand", values),
        personalBrand: tContext("personalBrand"),
      }}
    />
  );
}

export function TaskContextSectionContent({
  title,
  selection,
  project,
  defaultBrand,
  labels,
}: {
  title: string;
  selection: TaskContextSelectionSnapshot;
  project?: ProjectFilterOption | null;
  defaultBrand: EffectiveDesignMdAttachment | null;
  labels: {
    briefing: string;
    memory: string;
    brand: string;
    namedBrand: (values: { name: string }) => string;
    personalBrand: string;
  };
}) {
  // Detail shows what is attached on the task, not what the project still offers.
  const showBrand = selection.brandEnabled;
  const showBriefing = selection.briefingEnabled;
  const showMemory = selection.memoryEnabled;

  if (!showBrand && !showBriefing && !showMemory) {
    return null;
  }

  const brandDisplay = showBrand
    ? resolveBrandPillDisplay({
        brandSource: selection.brandSource,
        brandUrl: selection.brandUrl,
        project,
        defaultBrand,
        labels,
      })
    : null;

  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground text-xs font-medium">{title}</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {brandDisplay ? (
          <StaticContextPill
            label={brandDisplay.label}
            leading={brandDisplay.avatar}
          />
        ) : null}
        {showBriefing ? <StaticContextPill label={labels.briefing} /> : null}
        {showMemory ? <StaticContextPill label={labels.memory} /> : null}
      </div>
    </section>
  );
}

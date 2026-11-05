import type { AdminWritingSkills } from "@sokosumi/core-client";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";

import { WritingSkillMarkdown } from "./writing-skill-markdown";

type Skill = AdminWritingSkills["groups"][number]["skills"][number];

interface WritingSkillsViewProps {
  groups: AdminWritingSkills["groups"];
  /** The skill on show; the first one when none or an unknown one is asked for. */
  selectedId: string | undefined;
}

/** Every writing skill by group, beside the one selected, rendered in full. */
export async function WritingSkillsView({
  groups,
  selectedId,
}: WritingSkillsViewProps) {
  const t = await getTranslations("App.Admin.WritingSkills");
  const skills = groups.flatMap((group) => group.skills);
  const selected = skills.find((skill) => skill.id === selectedId) ?? skills[0];
  if (!selected)
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <nav aria-label={t("listLabel")} className={cn(HOLDER_CLASS, "h-fit")}>
        {groups.map((group) => (
          <div key={group.key} className="p-1">
            <h2 className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
              {group.name}
            </h2>
            {/* Pills that wrap on a phone, so the skill stays near the top; a column beside it on a wide screen. */}
            <ul className="flex flex-wrap gap-1 lg:block lg:space-y-1">
              {group.skills.map((skill) => (
                <li key={skill.id}>
                  <Link
                    href={`?skill=${skill.id}`}
                    aria-current={skill.id === selected.id ? "page" : undefined}
                    className={cn(
                      "block rounded-lg border border-transparent px-3 py-2 text-sm",
                      skill.id === selected.id
                        ? cn(HOLDER_ITEM_CLASS, "font-medium")
                        : HOLDER_ITEM_HOVER_CLASS,
                    )}
                  >
                    {skill.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <SkillDetail skill={selected} t={t} />
    </div>
  );
}

function SkillDetail({
  skill,
  t,
}: {
  skill: Skill;
  t: Awaited<ReturnType<typeof getTranslations<"App.Admin.WritingSkills">>>;
}) {
  return (
    <div className={HOLDER_CLASS}>
      <article className={cn(HOLDER_ITEM_CLASS, "space-y-6 p-6")}>
        <header className="space-y-2">
          <p className="text-muted-foreground text-sm">{skill.description}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground text-xs">
              {t("channels")}
            </span>
            {skill.channels.map((channel) => (
              <Badge key={channel} variant="outline">
                {channel}
              </Badge>
            ))}
          </div>
        </header>
        <WritingSkillMarkdown content={skill.content} />
        <section className="bg-muted space-y-3 rounded-lg p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">{t("checklist")}</h2>
            <p className="text-muted-foreground text-xs">
              {t("checklistHint")}
            </p>
          </div>
          <ul className="space-y-2">
            {skill.checklist.map((rule) => (
              <li key={rule.rule} className="flex gap-2 text-sm">
                <CheckCircle2
                  aria-hidden
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                />
                <span className="space-y-1">
                  <span className="block">{rule.rule}</span>
                  {rule.counted || rule.formats ? (
                    <span className="text-muted-foreground block text-xs">
                      {[
                        rule.formats
                          ? t("onlyFor", { formats: rule.formats.join(", ") })
                          : null,
                        rule.counted ? t("counted") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </article>
    </div>
  );
}

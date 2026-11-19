"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { SidebarLayout } from "@sokosumi/core-client";
import { ArrowDownAZ, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  hideSidebarFeature,
  MAX_SECTION_NAME_LENGTH,
  MAX_SIDEBAR_SECTIONS,
  moveSidebarSection,
  placeSidebarFeature,
  removeSidebarSection,
  type SidebarFeature,
  type SidebarLayoutSection,
  sortSidebarFeatures,
} from "./sidebar-layout";
import {
  LayoutDragRow,
  type LayoutDragTarget,
  layoutDragId,
  sidebarCollisions,
} from "./sidebar-layout-drag";

interface SidebarLayoutEditorProps {
  layout: SidebarLayout;
  features: readonly SidebarFeature[];
  sectionLabel: (section: SidebarLayoutSection) => string;
  renderItem: (id: string) => ReactNode;
  onChange: (layout: SidebarLayout | null) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}

export function SidebarLayoutEditor({
  layout,
  features,
  sectionLabel,
  renderItem,
  onChange,
  onSave,
  onCancel,
  saving = false,
}: SidebarLayoutEditorProps) {
  const t = useTranslations("App.Sidebar.Layout");
  const locale = useLocale();
  const handlePrefix = useId();
  const [naming, setNaming] = useState<{
    sectionId?: string;
    name: string;
  } | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const available = features.filter((feature) => feature.available);
  const byId = new Map(available.map((feature) => [feature.id, feature]));
  const labels = new Map(
    available.map((feature) => [feature.id, feature.label]),
  );
  const placed = new Set(layout.sections.flatMap((section) => section.items));
  const addable = available.filter((feature) => !placed.has(feature.id));
  const compare = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  }).compare;

  function replaceSection(section: SidebarLayoutSection) {
    onChange({
      ...layout,
      sections: layout.sections.map((entry) =>
        entry.id === section.id ? section : entry,
      ),
    });
  }

  function focusHandle(target: LayoutDragTarget) {
    requestAnimationFrame(() =>
      document
        .getElementById(`${handlePrefix}-${layoutDragId(target)}`)
        ?.focus(),
    );
  }

  function completeName(event: FormEvent) {
    event.preventDefault();
    const name = naming?.name.trim();
    if (!name || !naming) return;
    const section = layout.sections.find(({ id }) => id === naming.sectionId);
    if (section) {
      replaceSection({ ...section, name });
    } else {
      if (layout.sections.length >= MAX_SIDEBAR_SECTIONS) return;
      const id = crypto.randomUUID();
      onChange({
        ...layout,
        sections: [...layout.sections, { id, name, items: [] }],
      });
    }
    setNaming(null);
  }

  function finishDrag({ active, over }: DragEndEvent) {
    setDragLabel(null);
    if (saving || !over || active.id === over.id) return;
    const from = active.data.current;
    const to = over.data.current;
    if (!from || !to) return;
    if (from.kind === "section") {
      onChange(moveSidebarSection(layout, from.id, to.sectionId));
    } else {
      onChange(
        placeSidebarFeature(
          layout,
          from.id,
          to.sectionId,
          to.kind === "feature" ? to.id : undefined,
        ),
      );
    }
  }

  function stepMenu(
    index: number,
    length: number,
    onStep: (offset: number) => void,
  ) {
    return (
      <>
        <DropdownMenuItem disabled={index === 0} onSelect={() => onStep(-1)}>
          {t("moveUp")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === length - 1}
          onSelect={() => onStep(1)}
        >
          {t("moveDown")}
        </DropdownMenuItem>
      </>
    );
  }

  function renderSection(section: SidebarLayoutSection, index: number) {
    const label = sectionLabel(section);
    const visible = section.items.flatMap((id) => byId.get(id) ?? []);
    const target: LayoutDragTarget = {
      kind: "section",
      id: section.id,
      sectionId: section.id,
    };
    function move(offset: number) {
      const next = layout.sections[index + offset];
      if (!next) return;
      onChange(moveSidebarSection(layout, section.id, next.id));
      setAnnouncement(
        t("sectionPosition", {
          name: label,
          position: index + offset + 1,
          total: layout.sections.length,
        }),
      );
    }
    return (
      <LayoutDragRow
        key={section.id}
        target={target}
        handlePrefix={handlePrefix}
        label={label}
        onStep={move}
        preview={
          <h3 className="flex min-h-11 min-w-0 items-center text-sm font-medium md:min-h-7">
            <span className="truncate">{label}</span>
          </h3>
        }
        menu={
          <>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={!addable.length}>
                {t("addFeature")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {addable.map((feature) => (
                  <DropdownMenuItem
                    key={feature.id}
                    onSelect={() =>
                      onChange(
                        placeSidebarFeature(layout, feature.id, section.id),
                      )
                    }
                  >
                    {feature.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => setNaming({ sectionId: section.id, name: label })}
            >
              {t("renameSection")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={visible.length < 2}
              onSelect={() =>
                replaceSection(sortSidebarFeatures(section, labels, compare))
              }
            >
              {t("sortFeatures")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {stepMenu(index, layout.sections.length, move)}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                onChange(removeSidebarSection(layout, section.id))
              }
            >
              {t("removeSection")}
            </DropdownMenuItem>
          </>
        }
      >
        {visible.length === 0 ? (
          <p className="text-muted-foreground px-7 py-1 text-xs">
            {t("emptySection")}
          </p>
        ) : null}
        {visible.map((feature, itemIndex) => {
          const item: LayoutDragTarget = {
            kind: "feature",
            id: feature.id,
            sectionId: section.id,
          };
          function moveItem(offset: number) {
            const other = visible[itemIndex + offset];
            if (!other) return;
            onChange(
              placeSidebarFeature(layout, feature.id, section.id, other.id),
            );
            setAnnouncement(
              t("position", {
                name: feature.label,
                section: label,
                position: itemIndex + offset + 1,
                total: visible.length,
              }),
            );
          }
          function moveTo(sectionId: string) {
            const next = placeSidebarFeature(layout, feature.id, sectionId);
            const destination = next.sections.find(
              ({ id }) => id === sectionId,
            );
            if (!destination) return;
            onChange(next);
            const total = destination.items.filter((id) => byId.has(id)).length;
            setAnnouncement(
              t("position", {
                name: feature.label,
                section: sectionLabel(destination),
                position: total,
                total,
              }),
            );
            focusHandle(item);
          }
          const preview =
            feature.hasContent === false ? null : renderItem(feature.id);
          return (
            <LayoutDragRow
              key={feature.id}
              target={item}
              handlePrefix={handlePrefix}
              label={feature.label}
              onStep={moveItem}
              onSectionStep={(offset) => {
                const other = layout.sections[index + offset];
                if (other) moveTo(other.id);
              }}
              preview={
                preview == null ? (
                  <div className="flex min-h-11 items-center text-sm md:min-h-7">
                    {feature.label}
                  </div>
                ) : (
                  <div inert>{preview}</div>
                )
              }
              menu={
                <>
                  {stepMenu(itemIndex, visible.length, moveItem)}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      disabled={layout.sections.length < 2}
                    >
                      {t("moveTo")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {layout.sections
                        .filter(({ id }) => id !== section.id)
                        .map((destination) => (
                          <DropdownMenuItem
                            key={destination.id}
                            onSelect={() => moveTo(destination.id)}
                          >
                            {sectionLabel(destination)}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() =>
                      onChange(hideSidebarFeature(layout, feature.id))
                    }
                  >
                    {t("removeFeature")}
                  </DropdownMenuItem>
                </>
              }
            />
          );
        })}
      </LayoutDragRow>
    );
  }

  return (
    <div className="space-y-2 px-2 py-2">
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1 text-sm font-medium">{t("edit")}</h2>
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button size="sm" variant="primary" loading={saving} onClick={onSave}>
          {t("save")}
        </Button>
      </div>
      <div inert={saving}>
        <p className="sr-only" id={`${handlePrefix}-instructions`}>
          {t("instructions")}
        </p>
        <p className="sr-only" role="status">
          {announcement}
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={sidebarCollisions}
          onDragStart={({ active }) => {
            const data = active.data.current;
            const section = layout.sections.find(
              ({ id }) => id === data?.sectionId,
            );
            setDragLabel(
              data?.kind === "section" && section
                ? sectionLabel(section)
                : (labels.get(data?.id) ?? null),
            );
          }}
          onDragCancel={() => setDragLabel(null)}
          onDragEnd={finishDrag}
        >
          <div className="space-y-2">{layout.sections.map(renderSection)}</div>
          <DragOverlay dropAnimation={null}>
            {dragLabel ? (
              <div className="bg-background text-foreground w-fit max-w-full truncate rounded-md border px-2 py-1 text-sm shadow-md">
                {dragLabel}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
        <div className="flex items-center justify-between gap-1 pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={layout.sections.length >= MAX_SIDEBAR_SECTIONS}
            onClick={() => setNaming({ name: "" })}
          >
            <Plus aria-hidden />
            {t("addSection")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:size-8"
            aria-label={t("sortSections")}
            title={t("sortSections")}
            disabled={layout.sections.length < 2}
            onClick={() =>
              onChange({
                ...layout,
                sections: [...layout.sections].sort((a, b) =>
                  compare(sectionLabel(a), sectionLabel(b)),
                ),
              })
            }
          >
            <ArrowDownAZ aria-hidden />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("reset")}
        </Button>
      </div>
      <Dialog
        open={!!naming}
        onOpenChange={(open) => {
          if (!open) setNaming(null);
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {naming?.sectionId ? t("renameSection") : t("addSection")}
            </DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={completeName}>
            <Label htmlFor={`${handlePrefix}-name`}>{t("sectionName")}</Label>
            <Input
              id={`${handlePrefix}-name`}
              maxLength={MAX_SECTION_NAME_LENGTH}
              value={naming?.name ?? ""}
              onChange={(event) =>
                setNaming(
                  (current) =>
                    current && { ...current, name: event.target.value },
                )
              }
            />
            <Button type="submit" disabled={!naming?.name.trim()}>
              {naming?.sectionId ? t("renameSection") : t("addSection")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";

import { ListMobileCreateFab } from "@/app/components/list-mobile-create-fab";

import { useCreateTaskModal } from "./create-task-modal";

export function TasksMobileCreateFabSlot() {
  const { handleOpen } = useCreateTaskModal();
  const t = useTranslations("App.Tasks");

  return (
    <ListMobileCreateFab
      ariaLabel={t("createTaskFab")}
      className="bg-secondary text-secondary-foreground hover:bg-secondary-hover"
      onOpen={handleOpen}
    />
  );
}

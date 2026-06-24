"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
} from "@/components/ui/sidebar";

import AdminMenu from "./admin-menu";
import SettingsMenuButton from "./settings-menu-button.client";

interface AdminSettingsMenuGroupProps {
  adminMenuEnabled: boolean;
}

export default function AdminSettingsMenuGroup({
  adminMenuEnabled,
}: AdminSettingsMenuGroupProps) {
  return (
    <SidebarGroup className="w-full">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0">
          {adminMenuEnabled ? <AdminMenu /> : null}
          <SettingsMenuButton />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

import { createRoot } from "react-dom/client";

import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { SidebarScrollFrame } from "../sidebar-scroll-frame.client";

createRoot(document.getElementById("fixture")!).render(
  <div className="flex h-dvh w-64 flex-col">
    <SidebarScrollFrame>
      <SidebarHeader className="h-16">Workspace</SidebarHeader>
      <div className="shrink-0">
        <button type="button" className="h-48">
          Navigation
        </button>
      </div>
      <SidebarContent className="min-h-0 w-full flex-1 *:data-[slot=scroll-area-viewport]:overscroll-contain">
        {Array.from({ length: 50 }, (_, index) => (
          <a className="block h-8" href={`/room/${index}`} key={index}>
            Room {index}
          </a>
        ))}
      </SidebarContent>
      <SidebarFooter className="shrink-0">
        <button type="button">Account</button>
      </SidebarFooter>
    </SidebarScrollFrame>
  </div>,
);

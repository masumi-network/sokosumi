"use client";

import { ChevronLeft } from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SidebarSubmenuPanel {
  id: string;
  parentId: string | null;
  header: ReactNode;
  content: ReactNode;
}

interface SidebarSubmenuContextValue {
  activeId: string | null;
  backLabel: string;
  openSubmenu: (id: string) => void;
  goBack: () => void;
}

const SidebarSubmenuContext = createContext<SidebarSubmenuContextValue | null>(
  null,
);

interface SidebarSubmenuProps {
  activeId: string | null;
  onActiveIdChange: (id: string | null) => void;
  panels: SidebarSubmenuPanel[];
  backLabel: string;
  children: ReactNode;
}

function computePanelPath(
  panels: SidebarSubmenuPanel[],
  activeId: string | null,
): SidebarSubmenuPanel[] {
  if (!activeId) {
    return [];
  }

  const panelById = new Map(panels.map((panel) => [panel.id, panel]));
  const path: SidebarSubmenuPanel[] = [];
  let currentId: string | null = activeId;

  while (currentId) {
    const panel = panelById.get(currentId);
    if (!panel) {
      break;
    }
    path.unshift(panel);
    currentId = panel.parentId;
  }

  return path;
}

export function useSidebarSubmenu(): SidebarSubmenuContextValue {
  const context = use(SidebarSubmenuContext);
  if (!context) {
    throw new Error("useSidebarSubmenu must be used within SidebarSubmenu.");
  }

  return context;
}

export function SidebarSubmenuBackButton({
  className,
}: {
  className?: string;
}) {
  const { backLabel, goBack } = useSidebarSubmenu();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0", className)}
      aria-label={backLabel}
      onClick={goBack}
    >
      <ChevronLeft className="size-4" aria-hidden />
    </Button>
  );
}

export function SidebarSubmenu({
  activeId,
  onActiveIdChange,
  panels,
  backLabel,
  children,
}: SidebarSubmenuProps) {
  const activePanelRef = useRef<HTMLDivElement>(null);
  const pathPanels = useMemo(
    () => computePanelPath(panels, activeId),
    [panels, activeId],
  );
  const isMainActive = pathPanels.length === 0;

  const contextValue = useMemo<SidebarSubmenuContextValue>(
    () => ({
      activeId,
      backLabel,
      openSubmenu: onActiveIdChange,
      goBack: () => {
        if (!activeId) {
          return;
        }

        const panelById = new Map(panels.map((panel) => [panel.id, panel]));
        const currentPanel = panelById.get(activeId);
        onActiveIdChange(currentPanel?.parentId ?? null);
      },
    }),
    [activeId, backLabel, onActiveIdChange, panels],
  );

  useEffect(() => {
    if (!activeId) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      activePanelRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [activeId]);

  return (
    <SidebarSubmenuContext value={contextValue}>
      <div className="relative overflow-hidden">
        <div
          className="flex transition-transform duration-200 ease-linear"
          style={{
            transform: `translateX(-${pathPanels.length * 100}%)`,
          }}
        >
          <div
            className="w-full shrink-0"
            aria-hidden={!isMainActive}
            {...(!isMainActive ? { inert: true } : {})}
          >
            <div
              className={cn(!isMainActive && "pointer-events-none")}
              aria-hidden={!isMainActive}
            >
              {children}
            </div>
          </div>
          {pathPanels.map((panel, index) => {
            const isActive = index === pathPanels.length - 1;

            return (
              <div
                key={panel.id}
                ref={isActive ? activePanelRef : undefined}
                tabIndex={isActive ? -1 : undefined}
                className="w-full shrink-0 outline-hidden"
                aria-hidden={!isActive}
                {...(!isActive ? { inert: true } : {})}
              >
                <div
                  className={cn(
                    "bg-sidebar sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-2",
                    !isActive && "pointer-events-none",
                  )}
                >
                  <SidebarSubmenuBackButton />
                  <div className="min-w-0 flex-1">{panel.header}</div>
                </div>
                <div className={cn(!isActive && "pointer-events-none")}>
                  {panel.content}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SidebarSubmenuContext>
  );
}

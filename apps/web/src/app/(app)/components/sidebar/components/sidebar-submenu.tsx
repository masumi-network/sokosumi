"use client";

import { ChevronLeft } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
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

const SLIDE_TRANSITION_CLASS =
  "transition-transform duration-200 ease-out motion-reduce:transition-none";
const TRACK_PANEL_CLASS = "min-w-0 shrink-0 grow-0 basis-full";
export const SIDEBAR_SUBMENU_SLIDE_DURATION_MS = 200;

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

function SubmenuPanelView({
  panel,
  isActive,
  panelRef,
}: {
  panel: SidebarSubmenuPanel;
  isActive: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={panelRef}
      tabIndex={isActive ? -1 : undefined}
      className={cn(TRACK_PANEL_CLASS, "outline-hidden overflow-hidden")}
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
        <div className="min-w-0 flex-1 overflow-hidden">{panel.header}</div>
      </div>
      <div className={cn(!isActive && "pointer-events-none")}>
        {panel.content}
      </div>
    </div>
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
  const depth = pathPanels.length;
  const [trackPanels, setTrackPanels] = useState(pathPanels);
  const [trackDepth, setTrackDepth] = useState(depth);
  const isMainActive = trackDepth === 0;

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
    if (!activeId || trackDepth !== depth) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      activePanelRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [activeId, depth, trackDepth]);

  useEffect(() => {
    if (depth > trackDepth) {
      setTrackPanels(pathPanels);

      const frame = requestAnimationFrame(() => {
        setTrackDepth(depth);
      });

      return () => {
        cancelAnimationFrame(frame);
      };
    }

    setTrackDepth(depth);

    const timeout = window.setTimeout(() => {
      setTrackPanels(pathPanels);
    }, SIDEBAR_SUBMENU_SLIDE_DURATION_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [depth, pathPanels, trackDepth]);

  return (
    <SidebarSubmenuContext value={contextValue}>
      <div className="relative w-full overflow-hidden">
        <div
          className={cn("flex w-full", SLIDE_TRANSITION_CLASS)}
          style={{
            transform: `translateX(-${trackDepth * 100}%)`,
          }}
        >
          <div
            className={cn(
              TRACK_PANEL_CLASS,
              !isMainActive && "pointer-events-none",
            )}
            aria-hidden={!isMainActive}
            {...(!isMainActive ? { inert: true } : {})}
          >
            {children}
          </div>

          {trackPanels.map((panel, index) => {
            const isActive = index === trackDepth - 1;

            return (
              <SubmenuPanelView
                key={panel.id}
                panel={panel}
                isActive={isActive}
                panelRef={isActive ? activePanelRef : undefined}
              />
            );
          })}
        </div>
      </div>
    </SidebarSubmenuContext>
  );
}

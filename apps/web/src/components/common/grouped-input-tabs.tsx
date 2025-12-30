"use client";

import type { InputGroupSchemaType } from "@sokosumi/masumi/schemas";
import * as React from "react";

import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from "@/components/ui/motion-tabs";
import { cn } from "@/lib/utils";

interface GroupedInputTabsProps {
  groups: InputGroupSchemaType[];
  activeGroupIndex: number;
  maxUnlockedGroupIndex: number;
  onTabChange: (value: string) => void;
  renderGroup: (
    group: InputGroupSchemaType,
    index: number,
    isLast: boolean,
  ) => React.ReactNode;
  isValidating?: boolean;
  className?: string;
}

export function GroupedInputTabs({
  groups,
  activeGroupIndex,
  maxUnlockedGroupIndex,
  onTabChange,
  renderGroup,
  isValidating = false,
  className,
}: GroupedInputTabsProps) {
  const handleTabChange = React.useCallback(
    (value: string) => {
      if (isValidating) return;
      onTabChange(value);
    },
    [isValidating, onTabChange],
  );

  if (!groups || groups.length === 0) {
    return null;
  }

  const totalGroups = groups.length;
  const activeValue = groups[activeGroupIndex]?.id ?? groups[0]?.id ?? "";

  if (!activeValue) {
    return null;
  }

  return (
    <Tabs
      value={activeValue}
      onValueChange={handleTabChange}
      className={cn("w-full min-w-0 gap-4", className)}
    >
      <div className="w-full overflow-x-auto">
        <TabsList
          className="mb-2 w-max min-w-full justify-start border"
          activeClassName="bg-primary"
          aria-label="Input groups"
        >
          {groups.map((group, index) => {
            const isDisabled = index > maxUnlockedGroupIndex || isValidating;
            const isActive = groups[activeGroupIndex]?.id === group.id;

            return (
              <TabsTrigger
                key={group.id}
                value={group.id}
                disabled={isDisabled}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex-none",
                  isDisabled && "cursor-not-allowed opacity-50",
                )}
              >
                {group.title}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      <TabsContents className="-m-3">
        {groups.map((group, index) => (
          <TabsContent key={group.id} value={group.id} className="p-1">
            <div className="flex h-full flex-col gap-6">
              {renderGroup(group, index, index === totalGroups - 1)}
            </div>
          </TabsContent>
        ))}
      </TabsContents>
    </Tabs>
  );
}

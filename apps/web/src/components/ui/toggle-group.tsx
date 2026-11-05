"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import {
  SEGMENTED_CONTROL_CLASS_NAME,
  SEGMENTED_CONTROL_ITEM_CLASS_NAME,
} from "@/components/ui/segmented-control-classes"

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(SEGMENTED_CONTROL_CLASS_NAME, className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(SEGMENTED_CONTROL_ITEM_CLASS_NAME, className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }

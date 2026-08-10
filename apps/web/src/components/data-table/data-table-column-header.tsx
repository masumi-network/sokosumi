"use client";

import type { Column, RowData } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { DataTableFeatures } from "./data-table-features";

interface DataTableColumnHeaderProps<TData extends RowData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<DataTableFeatures, TData, TValue>;
  title: string;
}

export default function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const t = useTranslations("Components.DataTable.ColumnHeader");

  if (!column.getCanSort()) {
    return <div className={cn("p-2", className)}>{title}</div>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("data-[state=open]:bg-accent h-8 p-2!", className)}
        >
          <span>{title}</span>
          {column.getIsSorted() === "desc" ? (
            <ArrowDown />
          ) : column.getIsSorted() === "asc" ? (
            <ArrowUp />
          ) : (
            <ChevronsUpDown />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
          <ArrowUp className="text-muted-foreground/70 size-4" />
          {t("ascending")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
          <ArrowDown className="text-muted-foreground/70 size-4" />
          {t("descending")}
        </DropdownMenuItem>
        {column.getCanHide() && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
              <EyeOff className="text-muted-foreground/70 size-4" />
              {t("hide")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

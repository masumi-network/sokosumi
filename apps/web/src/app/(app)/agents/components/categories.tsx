"use client";

import { CirclePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Category } from "@/lib/types/category";
import { cn } from "@/lib/utils";

interface CategoriesProps {
  appliedCategories: string[];
  onApplyCategories: (categories: string[]) => void;
  categories: Category[];
}

export default function Categories({
  appliedCategories,
  onApplyCategories,
  categories: validCategories,
}: CategoriesProps) {
  const t = useTranslations("App.Agents.FilterSection");
  const isMobile = useIsMobile();

  const [categories, setCategories] = useState<string[]>(appliedCategories);
  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setOpen(newOpen);
      // Reset categories to applied categories when opening the dropdown
      if (newOpen) {
        setCategories(appliedCategories);
      }
    },
    [appliedCategories],
  );

  const handleCheckCategory = useCallback(
    (categorySlug: string, checked: boolean) => {
      if (checked) {
        setCategories([...categories, categorySlug]);
      } else {
        setCategories(categories.filter((c) => c !== categorySlug));
      }
    },
    [categories],
  );

  const handleToggleCategory = useCallback(
    (category: string) => {
      if (appliedCategories.includes(category)) {
        onApplyCategories(appliedCategories.filter((c) => c !== category));
      } else {
        onApplyCategories([...appliedCategories, category]);
      }
    },
    [appliedCategories, onApplyCategories],
  );

  if (validCategories.length === 0) {
    return null;
  }

  // Mobile: inline buttons with horizontal scroll
  if (isMobile) {
    return (
      <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-2">
          {validCategories.map((category) => {
            const isSelected = appliedCategories.includes(category.slug);
            return (
              <Button
                key={category.slug}
                variant={isSelected ? "default" : "outline"}
                size="default"
                onClick={() => handleToggleCategory(category.slug)}
                className={cn(
                  "shrink-0 text-sm",
                  isSelected && "bg-primary text-primary-foreground",
                )}
              >
                {category.name}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }

  // Desktop: dropdown menu
  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="items-center gap-2 border-dashed text-base"
        >
          {appliedCategories.length === 0 ? (
            <CirclePlus className="h-4 w-4" />
          ) : (
            <Badge>{appliedCategories.length}</Badge>
          )}
          {t("categories")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{t("selectCategories")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {validCategories.map((category) => (
            <DropdownMenuCheckboxItem
              key={category.slug}
              onSelect={(e) => e.preventDefault()}
              checked={categories.includes(category.slug)}
              onCheckedChange={(checked) =>
                handleCheckCategory(category.slug, checked)
              }
            >
              <span className="truncate">{category.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <Button
          className="w-full"
          variant="primary"
          onClick={() => {
            onApplyCategories(categories);
            handleOpenChange(false);
          }}
        >
          {t("applyCategories")}
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

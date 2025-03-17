"use client";

import { CirclePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

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

const ValidTags = ["Analytics", "Finance", "Trends", "Forecasting", "Data"];

interface TagsProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export default function Tags({ tags, onChange }: TagsProps) {
  const t = useTranslations("App.Gallery.FilterSection");

  const handleSelectTag = (tag: string, checked: boolean) => {
    if (checked) {
      onChange([...tags, tag]);
    } else {
      onChange(tags.filter((t) => t !== tag));
    }
  };

  return (
    <div className="flex gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-12 items-center gap-2 border-dashed text-base"
          >
            {tags.length === 0 ? (
              <CirclePlus className="h-4 w-4" />
            ) : (
              <Badge>{tags.length}</Badge>
            )}
            {t("tags")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>{t("selectTags")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ValidTags.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag}
              className="hover:bg-foreground hover:text-white"
              checked={tags.includes(tag)}
              onCheckedChange={(checked) => handleSelectTag(tag, checked)}
            >
              {tag}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

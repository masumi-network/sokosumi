"use client";

import { CirclePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { FixedSizeList, ListChildComponentProps } from "react-window";

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

interface TagsProps {
  appliedTags: string[];
  onApplyTags: (tags: string[]) => void;
  tags: string[];
}

export default function Tags({
  appliedTags,
  onApplyTags,
  tags: validTags,
}: TagsProps) {
  const t = useTranslations("App.Agents.FilterSection");

  const [tags, setTags] = useState<string[]>(appliedTags);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) setTags(appliedTags);
  }, [open, appliedTags, setTags]);

  const handleCheckTag = (tag: string, checked: boolean) => {
    if (checked) {
      setTags([...tags, tag]);
    } else {
      setTags(tags.filter((t) => t !== tag));
    }
  };

  const Row = ({ index, style }: ListChildComponentProps) => {
    const tag = validTags[index];
    return (
      <DropdownMenuCheckboxItem
        key={tag}
        onSelect={(e) => e.preventDefault()}
        style={style}
        checked={tags.includes(tag)}
        onCheckedChange={(checked) => handleCheckTag(tag, checked)}
      >
        {tag}
      </DropdownMenuCheckboxItem>
    );
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="items-center gap-2 border-dashed text-base"
        >
          {appliedTags.length === 0 ? (
            <CirclePlus className="h-4 w-4" />
          ) : (
            <Badge>{appliedTags.length}</Badge>
          )}
          {t("tags")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>{t("selectTags")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <FixedSizeList
          height={360}
          itemCount={validTags.length}
          width="100%"
          itemSize={36}
        >
          {Row}
        </FixedSizeList>
        <DropdownMenuSeparator />
        <Button
          className="w-full"
          onClick={() => {
            onApplyTags(tags);
            setOpen(false);
          }}
        >
          {t("applyTags")}
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

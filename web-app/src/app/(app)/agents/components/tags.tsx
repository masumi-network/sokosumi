"use client";

import { CirclePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { List, RowComponentProps } from "react-window";

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

  const handleCheckTag = useCallback(
    (tag: string, checked: boolean) => {
      if (checked) {
        setTags([...tags, tag]);
      } else {
        setTags(tags.filter((t) => t !== tag));
      }
    },
    [tags, setTags],
  );

  const MemoizedList = useMemo(() => {
    return (
      <List
        rowComponent={TagRow}
        rowCount={validTags.length}
        className="h-80 w-full"
        rowHeight={36}
        rowProps={{ tags, validTags, handleCheckTag }}
      />
    );
  }, [tags, validTags, handleCheckTag]);

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
        {MemoizedList}
        <DropdownMenuSeparator />
        <Button
          className="w-full"
          variant="primary"
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

const TagRow = ({
  index,
  validTags,
  tags,
  handleCheckTag,
  style,
}: RowComponentProps<{
  validTags: string[];
  tags: string[];
  handleCheckTag: (tag: string, checked: boolean) => void;
}>) => {
  const tag = validTags[index];
  return (
    <DropdownMenuCheckboxItem
      key={tag}
      onSelect={(e) => e.preventDefault()}
      style={style}
      checked={tags.includes(tag)}
      onCheckedChange={(checked) => handleCheckTag(tag, checked)}
    >
      <span className="truncate">{tag}</span>
    </DropdownMenuCheckboxItem>
  );
};

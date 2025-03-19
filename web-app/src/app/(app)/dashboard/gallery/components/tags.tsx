"use client";

import { CirclePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";

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
import { ScrollArea } from "@/components/ui/scroll-area";

interface TagsProps {
  appliedTags: string[];
  onApplyTags: (tags: string[]) => void;
  agentsTags: string[];
}

export default function Tags({
  appliedTags,
  onApplyTags,
  agentsTags,
}: TagsProps) {
  const t = useTranslations("App.Gallery.FilterSection");
  const [tags, setTags] = useState<string[]>(appliedTags);
  const [open, setOpen] = useState(false);
  const handleCheckTags = (tag: string, checked: boolean) => {
    if (checked) {
      setTags([...tags, tag]);
    } else {
      setTags(tags.filter((t) => t !== tag));
    }
  };

  return (
    <div className="flex gap-2">
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
          <ScrollArea>
            <div className="max-h-96">
              {agentsTags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag}
                  onSelect={(e) => e.preventDefault()}
                  className="hover:bg-foreground hover:text-white"
                  checked={tags.includes(tag)}
                  onCheckedChange={(checked) => handleCheckTags(tag, checked)}
                >
                  {tag}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          </ScrollArea>
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
    </div>
  );
}

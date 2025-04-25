"use client";

import { ArrowUp } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface InputWithButtonProps {
  onSubmit?: (value: string) => void;
  placeholder?: string;
  defaultValue?: string;
}

export default function InputWithButton({
  onSubmit,
  placeholder = "Search Agents",
  defaultValue = "",
}: InputWithButtonProps) {
  const [value, setValue] = useState(defaultValue);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(value);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-input-background border-input-border flex h-12 w-56 items-center rounded-lg border"
    >
      <div className="relative flex-1">
        <Input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cn(
            "h-full w-full border-none pr-12 focus-visible:ring-0 focus-visible:ring-offset-0",
            "text-muted-foreground placeholder:text-muted-foreground",
          )}
        />
        <Button
          type="submit"
          size="icon"
          className="background-input-border border-radius-md absolute top-1/2 right-1 h-8 w-8 -translate-y-1/2 opacity-50"
          aria-label="Submit"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}

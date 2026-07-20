"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ClientSecretFieldProps {
  secret: string;
  label: string;
  warning: string;
  copyLabel: string;
  showLabel: string;
  hideLabel: string;
  onCopy: (value: string) => Promise<void>;
}

export function ClientSecretField({
  secret,
  label,
  warning,
  copyLabel,
  showLabel,
  hideLabel,
  onCopy,
}: ClientSecretFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-muted-foreground mb-2 text-xs">{warning}</p>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            type={isVisible ? "text" : "password"}
            value={secret}
            readOnly
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            className="font-mono pr-10 text-sm"
          />
          <button
            type="button"
            onClick={() => setIsVisible((value) => !value)}
            aria-label={isVisible ? hideLabel : showLabel}
            className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex items-center pr-3"
            tabIndex={-1}
          >
            {isVisible ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onCopy(secret)}
        >
          {copyLabel}
        </Button>
      </div>
    </div>
  );
}

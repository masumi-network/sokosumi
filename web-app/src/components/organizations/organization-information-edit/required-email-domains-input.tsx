"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { isValidDomain } from "./data";

interface RequiredEmailDomainsInputProps {
  id: string;
  domains: string[];
  onChange: (domains: string[]) => void;
  placeholder?: string | undefined;
}

export default function RequiredEmailDomainsInput({
  id,
  domains,
  onChange,
  placeholder,
}: RequiredEmailDomainsInputProps) {
  const t = useTranslations(
    "Components.Organizations.EditInformationModal.Form.Fields.RequiredEmailDomains",
  );
  const [newDomain, setNewDomain] = useState("");

  const handleAddDomain: React.MouseEventHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isValidDomain(newDomain)) {
      toast.error(t("invalid"));
      return;
    }

    if (
      domains.some((domain) => domain.toLowerCase() === newDomain.toLowerCase())
    ) {
      toast.error(t("duplicate"));
      return;
    }

    onChange([...domains, newDomain]);
    setNewDomain("");
  };

  const handleRemoveDomain = (domain: string) => {
    onChange(domains.filter((d) => d.toLowerCase() !== domain.toLowerCase()));
  };

  return (
    <div className="flex flex-col gap-2">
      <div id={id} className="flex flex-wrap gap-2 rounded-md border p-2">
        {domains.length === 0 && (
          <p className="text-muted-foreground px-2 text-sm">{t("noDomains")}</p>
        )}
        {domains.map((domain) => (
          <Badge
            key={domain}
            className="hover:bg-destructive/50 flex cursor-pointer items-center gap-1"
            onClick={() => handleRemoveDomain(domain)}
          >
            {domain}
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          placeholder={placeholder}
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
        />
        <Button
          type="button"
          size="icon"
          disabled={!isValidDomain(newDomain)}
          onClick={handleAddDomain}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

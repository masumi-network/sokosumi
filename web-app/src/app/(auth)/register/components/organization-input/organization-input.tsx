"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Organization } from "@/prisma/generated/client";

import CreateOrganization from "./create-organization";
import { createOrganizationSchema, CreateOrganizationSchemaType } from "./data";

interface OrganizationInputProps {
  organizations: Organization[];
  value: Organization | undefined;
  onChange: (organization: Organization) => void;
}

export default function OrganizationInput({
  organizations,
  value,
  onChange,
}: OrganizationInputProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form.Fields.Organization");
  const [open, setOpen] = useState(false);

  const createOrganizationForm = useForm<CreateOrganizationSchemaType>({
    resolver: zodResolver(
      createOrganizationSchema(
        useTranslations(
          "Auth.Pages.SignUp.Form.Fields.Organization.Schema.Name",
        ),
      ),
    ),
    defaultValues: {
      name: "",
    },
  });
  const organizationName = createOrganizationForm.watch("name");
  const handleOrganizationNameChange = (name: string) => {
    createOrganizationForm.setValue("name", name);
  };

  const handleOpenChange = (open: boolean) => {
    if (createOrganizationForm.formState.isSubmitting) {
      return;
    }
    setOpen(open);
  };

  const handleSelectOrganization = (organization: Organization) => {
    onChange(organization);
    setOpen(false);
  };

  return (
    <div>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            aria-expanded={open}
            variant="outline"
            className={cn("w-full justify-between font-normal", {
              "text-muted-foreground hover:text-muted-foreground": !value,
            })}
          >
            {value?.name ?? t("placeholder")}
            <ChevronsUpDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="p-0">
          <Command
            value={organizationName}
            onValueChange={handleOrganizationNameChange}
          >
            <CommandInput placeholder={t("search")} />
            <CommandList>
              <CommandEmpty className="p-2">
                <CreateOrganization form={createOrganizationForm} />
              </CommandEmpty>
              <CommandGroup>
                {organizations.map((organization) => (
                  <CommandItem
                    key={organization.id}
                    value={organization.name}
                    onSelect={() => handleSelectOrganization(organization)}
                  >
                    {organization.name}
                    <Check
                      className={cn(
                        "ml-auto",
                        value?.id === organization.id
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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
import { OrganizationWithRelations } from "@/lib/db/types/organization";
import {
  createOrganizationSchema,
  CreateOrganizationSchemaType,
} from "@/lib/schemas/organization";
import { cn, isValidEmail } from "@/lib/utils";

import CreateOrganization from "./create-organization";

interface OrganizationInputProps {
  email: string;
  organizations: OrganizationWithRelations[];
  value: OrganizationWithRelations | { name: string } | undefined;
  isLoading: boolean;
  onChange: (
    organization: OrganizationWithRelations | { name: string },
  ) => void;
  disabled?: boolean | undefined;
}

export default function OrganizationInput({
  email,
  isLoading,
  organizations,
  value,
  onChange,
  disabled,
}: OrganizationInputProps) {
  const t = useTranslations("Auth.Pages.SignUp.Form.Fields.Organization");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const createOrganizationForm = useForm<CreateOrganizationSchemaType>({
    resolver: zodResolver(
      createOrganizationSchema(useTranslations("Library.Auth.Schema")),
    ),
    defaultValues: {
      name: "",
    },
  });

  const handleOpenChange = (open: boolean) => {
    if (createOrganizationForm.formState.isSubmitting) {
      return;
    }
    createOrganizationForm.setValue("name", "");
    setOpen(open);
  };

  const handleNewOrganization = () => {
    setCreating(true);
  };

  const handleCommandInputChange = (value: string) => {
    createOrganizationForm.setValue("name", value.trim());
  };

  const handleSelectOrganization = (
    organizationId: string | null,
    organizationName: string | null,
  ) => {
    setCreating(false);
    setOpen(false);
    createOrganizationForm.setValue("name", "");
    const organization = organizations.find(
      (organization) => organization.id === organizationId,
    );

    if (!organization) {
      if (organizationName) {
        onChange({ name: organizationName });
      }
      return;
    }
    onChange(organization);
  };

  const isEmailValid = isValidEmail(email);

  const EmptySection = () => {
    return (
      <CommandEmpty className="p-0">
        {!isEmailValid && (
          <div className="text-muted-foreground p-2 text-center text-sm">
            {t("invalidEmail")}
          </div>
        )}
      </CommandEmpty>
    );
  };

  const NewOrganizationSection = () => {
    if (!isEmailValid) return null;
    return (
      <div className="p-2">
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          onClick={handleNewOrganization}
        >
          {t("new")}
        </Button>
      </div>
    );
  };

  const OrganizationsSection = () => {
    if (!isEmailValid) return null;
    return (
      <CommandGroup className={organizations.length === 0 ? "p-0" : "p-2"}>
        {isLoading == true && (
          <div className="flex items-center justify-center p-2">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {organizations.map((organization) => (
          <CommandItem
            key={organization.id}
            value={organization.name}
            onSelect={() =>
              handleSelectOrganization(organization.id, organization.name)
            }
            className="flex items-center gap-2"
          >
            <Check
              className={
                value && "id" in value && value.id === organization.id
                  ? "opacity-100"
                  : "opacity-0"
              }
            />
            <span className="flex-1">{organization.name}</span>
            <span className="text-muted-foreground text-sm">
              {organization._count.members}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    );
  };

  return (
    <div>
      <Popover open={!disabled && open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            aria-expanded={open}
            variant="outline"
            className={cn("w-full justify-between font-normal", {
              "text-muted-foreground hover:text-muted-foreground": !value,
            })}
            disabled={disabled}
          >
            {value?.name ?? t("placeholder")}
            <ChevronsUpDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="p-0">
          {creating && (
            <div className="p-2">
              <CreateOrganization
                email={email}
                form={createOrganizationForm}
                onAfterCreate={(data) =>
                  handleSelectOrganization(null, data.name)
                }
                onBack={() => setCreating(false)}
              />
            </div>
          )}
          {!creating && (
            <Command>
              <CommandInput
                onValueChange={handleCommandInputChange}
                placeholder={t("search")}
              />
              <NewOrganizationSection />
              <CommandList>
                <EmptySection />
                <OrganizationsSection />
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

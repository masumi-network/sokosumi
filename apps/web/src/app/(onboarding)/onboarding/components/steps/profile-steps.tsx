"use client";

import {
  ONBOARDING_COMPANY_SIZES,
  ONBOARDING_COMPANY_TYPES,
  ONBOARDING_ROLES,
  type OnboardingCompanySize,
  type OnboardingCompanyType,
  type OnboardingRole,
} from "@sokosumi/utils";
import { useTranslations } from "next-intl";

import { OptionList } from "../option-list";
import { StepShell } from "../step-shell";

/** Keeps the option card in the same column width across every question. */
const LIST_WRAPPER_CLASS = "mx-auto mt-8 w-full max-w-md";

interface CompanyTypeStepProps {
  companyType: null | OnboardingCompanyType;
  onCompanyTypeChange: (value: OnboardingCompanyType) => void;
}

export function CompanyTypeStep({
  companyType,
  onCompanyTypeChange,
}: CompanyTypeStepProps) {
  const t = useTranslations("Onboarding.Flow.CompanyType");

  return (
    <StepShell title={t("title")}>
      <div className={LIST_WRAPPER_CLASS}>
        <OptionList
          items={ONBOARDING_COMPANY_TYPES.map((value) => ({
            label: t(`options.${value}`),
            value,
          }))}
          onSelect={onCompanyTypeChange}
          value={companyType}
        />
      </div>
    </StepShell>
  );
}

interface CompanySizeStepProps {
  companySize: null | OnboardingCompanySize;
  onCompanySizeChange: (value: OnboardingCompanySize) => void;
}

export function CompanySizeStep({
  companySize,
  onCompanySizeChange,
}: CompanySizeStepProps) {
  const t = useTranslations("Onboarding.Flow.CompanySize");

  return (
    <StepShell title={t("title")}>
      <div className={LIST_WRAPPER_CLASS}>
        <OptionList
          items={ONBOARDING_COMPANY_SIZES.map((value) => ({
            label: t(`options.${value}`),
            value,
          }))}
          onSelect={onCompanySizeChange}
          value={companySize}
        />
      </div>
    </StepShell>
  );
}

interface RoleStepProps {
  onRoleChange: (value: OnboardingRole) => void;
  role: null | OnboardingRole;
}

export function RoleStep({ onRoleChange, role }: RoleStepProps) {
  const t = useTranslations("Onboarding.Flow.Role");

  return (
    <StepShell title={t("title")}>
      <div className={LIST_WRAPPER_CLASS}>
        <OptionList
          items={ONBOARDING_ROLES.map((value) => ({
            label: t(`options.${value}`),
            value,
          }))}
          onSelect={onRoleChange}
          value={role}
        />
      </div>
    </StepShell>
  );
}

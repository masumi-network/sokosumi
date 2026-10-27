"use client";

import type { NewsletterBlock } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useFormContext } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { NewsletterIssueValues } from "@/lib/schemas/newsletter-issues";

type BlockTextFieldName =
  `content.${number}.${"text" | "url" | "alt" | "href" | "label"}`;

function BlockTextField({
  name,
  label,
  multiline,
  maxLength,
  url,
}: {
  name: BlockTextFieldName;
  label: string;
  multiline?: boolean;
  maxLength: number;
  url?: boolean;
}) {
  const { control } = useFormContext<NewsletterIssueValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            {multiline ? (
              <Textarea
                {...field}
                value={field.value ?? ""}
                rows={5}
                maxLength={maxLength}
              />
            ) : (
              <Input
                {...field}
                value={field.value ?? ""}
                maxLength={maxLength}
                type={url ? "url" : "text"}
                onChange={(event) =>
                  field.onChange(
                    name.endsWith(".href") && !event.target.value
                      ? undefined
                      : event.target.value,
                  )
                }
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function IssueBlockFields({
  index,
  block,
  disabled,
}: {
  index: number;
  block: NewsletterBlock;
  disabled: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const { control } = useFormContext<NewsletterIssueValues>();
  switch (block.type) {
    case "heading":
      return (
        <>
          <BlockTextField
            name={`content.${index}.text`}
            label={t("blockTypes.heading")}
            maxLength={1000}
          />
          <FormField
            control={control}
            name={`content.${index}.level`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("level")}</FormLabel>
                <Select
                  disabled={disabled}
                  value={String(field.value)}
                  onValueChange={(value) =>
                    field.onChange(value === "2" ? 2 : 1)
                  }
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="1">{t("mainHeading")}</SelectItem>
                    <SelectItem value="2">{t("subheading")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      );
    case "text":
      return (
        <BlockTextField
          name={`content.${index}.text`}
          label={t("text")}
          multiline
          maxLength={100000}
        />
      );
    case "image":
      return (
        <>
          <BlockTextField
            name={`content.${index}.url`}
            label={t("imageUrl")}
            maxLength={2048}
            url
          />
          <BlockTextField
            name={`content.${index}.alt`}
            label={t("alt")}
            maxLength={1000}
          />
          <BlockTextField
            name={`content.${index}.href`}
            label={t("imageLink")}
            maxLength={2048}
            url
          />
          <p className="text-muted-foreground text-sm">{t("httpsHint")}</p>
        </>
      );
    case "button":
      return (
        <>
          <BlockTextField
            name={`content.${index}.label`}
            label={t("buttonLabel")}
            maxLength={200}
          />
          <BlockTextField
            name={`content.${index}.url`}
            label={t("buttonUrl")}
            maxLength={2048}
            url
          />
          <p className="text-muted-foreground text-sm">{t("httpsHint")}</p>
        </>
      );
    case "divider":
      return <hr />;
  }
}

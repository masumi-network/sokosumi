"use client";

import {
  NEWSLETTER_SOCIAL_NETWORKS,
  type NewsletterBlock,
} from "@sokosumi/utils";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { NewsletterImageUpload } from "@/app/newsletter/newsletter-image-upload";
import { Button } from "@/components/ui/button";
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
  | `content.${number}.${"text" | "url" | "alt" | "href" | "label"}`
  | `content.${number}.columns.${number}.${"text" | "imageUrl" | "alt"}`
  | `content.${number}.links.${number}.url`;

type BlockChoiceFieldName = `content.${number}.${
  | "level"
  | "width"
  | "align"
  | "size"}`;

const IMAGE_WIDTHS = ["100", "75", "50", "25"] as const;
const IMAGE_ALIGNS = ["left", "center", "right"] as const;
const SPACER_SIZES = ["sm", "md", "lg"] as const;

function BlockTextField({
  name,
  label,
  multiline,
  maxLength,
  url,
  optional,
}: {
  name: BlockTextFieldName;
  label: string;
  multiline?: boolean;
  maxLength: number;
  url?: boolean;
  /** An empty value removes the field, as optional schema fields expect. */
  optional?: boolean;
}) {
  const { control } = useFormContext<NewsletterIssueValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
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
                    optional && !event.target.value
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

/** A select over a block's fixed choices; `parse` maps the option back to the stored value. */
function BlockChoiceField({
  name,
  label,
  disabled,
  options,
  value,
  parse,
}: {
  name: BlockChoiceFieldName;
  label: string;
  disabled: boolean;
  options: readonly { value: string; label: string }[];
  value: (stored: unknown) => string;
  parse: (option: string) => unknown;
}) {
  const { control } = useFormContext<NewsletterIssueValues>();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel>{label}</FormLabel>
          <Select
            disabled={disabled}
            value={value(field.value)}
            onValueChange={(option) => field.onChange(parse(option))}
          >
            <FormControl>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Upload a file or keep a pasted URL; both end in the same field. */
function BlockImageField({
  name,
  disabled,
  optional,
}: {
  name:
    | `content.${number}.url`
    | `content.${number}.columns.${number}.imageUrl`;
  disabled: boolean;
  optional?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const { control, setValue } = useFormContext<NewsletterIssueValues>();
  const value = useWatch({ control, name });
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-4">
      <NewsletterImageUpload
        kind="image"
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(url) =>
          setValue(name, optional && !url ? undefined : url, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
      />
      <div className="min-w-0 flex-1 basis-48">
        <BlockTextField
          name={name}
          label={t("imageUrl")}
          maxLength={2048}
          url
          optional={optional}
        />
      </div>
    </div>
  );
}

function ColumnsFields({
  index,
  disabled,
}: {
  index: number;
  disabled: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const { control } = useFormContext<NewsletterIssueValues>();
  const columns = useFieldArray({
    control,
    name: `content.${index}.columns`,
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 @2xl:grid-cols-2">
        {columns.fields.map((column, columnIndex) => (
          <fieldset
            key={column.id}
            aria-label={t("Columns.column", { number: columnIndex + 1 })}
            className="min-w-0 space-y-3 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {t("Columns.column", { number: columnIndex + 1 })}
              </p>
              {!disabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 md:size-8"
                  disabled={columns.fields.length <= 2}
                  aria-label={t("Columns.remove", { number: columnIndex + 1 })}
                  onClick={() => columns.remove(columnIndex)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </div>
            <BlockTextField
              name={`content.${index}.columns.${columnIndex}.text`}
              label={t("text")}
              multiline
              maxLength={20_000}
            />
            <BlockImageField
              name={`content.${index}.columns.${columnIndex}.imageUrl`}
              disabled={disabled}
              optional
            />
            <BlockTextField
              name={`content.${index}.columns.${columnIndex}.alt`}
              label={t("alt")}
              maxLength={1000}
              optional
            />
          </fieldset>
        ))}
      </div>
      {!disabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={columns.fields.length >= 3}
          onClick={() => columns.append({ text: "" })}
        >
          <Plus />
          {t("Columns.add")}
        </Button>
      ) : null}
    </div>
  );
}

function SocialLinksFields({
  index,
  disabled,
}: {
  index: number;
  disabled: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Issues");
  const { control } = useFormContext<NewsletterIssueValues>();
  const links = useFieldArray({ control, name: `content.${index}.links` });
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {links.fields.map((link, linkIndex) => (
          <li
            key={link.id}
            className="grid min-w-0 items-end gap-2 @lg:grid-cols-[10rem_minmax(0,1fr)_auto]"
          >
            <FormField
              control={control}
              name={`content.${index}.links.${linkIndex}.network`}
              render={({ field }) => (
                <FormItem className="min-w-0">
                  <FormLabel>
                    {t("Social.network", { number: linkIndex + 1 })}
                  </FormLabel>
                  <Select
                    disabled={disabled}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {NEWSLETTER_SOCIAL_NETWORKS.map((network) => (
                        <SelectItem key={network} value={network}>
                          {t(`Social.networks.${network}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <BlockTextField
              name={`content.${index}.links.${linkIndex}.url`}
              label={t("Social.url", { number: linkIndex + 1 })}
              maxLength={2048}
              url
            />
            {!disabled ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10"
                disabled={links.fields.length <= 1}
                aria-label={t("Social.remove", { number: linkIndex + 1 })}
                onClick={() => links.remove(linkIndex)}
              >
                <Trash2 />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {!disabled ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={links.fields.length >= 8}
          onClick={() => links.append({ network: "website", url: "" })}
        >
          <Plus />
          {t("Social.add")}
        </Button>
      ) : null}
      <p className="text-muted-foreground text-sm">{t("httpsHint")}</p>
    </div>
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
  switch (block.type) {
    case "heading":
      return (
        <>
          <BlockTextField
            name={`content.${index}.text`}
            label={t("blockTypes.heading")}
            maxLength={1000}
          />
          <BlockChoiceField
            name={`content.${index}.level`}
            label={t("level")}
            disabled={disabled}
            options={[
              { value: "1", label: t("mainHeading") },
              { value: "2", label: t("subheading") },
            ]}
            value={String}
            parse={(option) => (option === "2" ? 2 : 1)}
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
          <BlockImageField name={`content.${index}.url`} disabled={disabled} />
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
            optional
          />
          <div className="grid gap-4 @lg:grid-cols-2">
            <BlockChoiceField
              name={`content.${index}.width`}
              label={t("Image.width")}
              disabled={disabled}
              options={IMAGE_WIDTHS.map((width) => ({
                value: width,
                label: t(`Image.widths.${width}`),
              }))}
              value={(stored) => String(stored ?? 100)}
              parse={(option) =>
                option === "100" ? undefined : Number(option)
              }
            />
            <BlockChoiceField
              name={`content.${index}.align`}
              label={t("Image.align")}
              disabled={disabled}
              options={IMAGE_ALIGNS.map((align) => ({
                value: align,
                label: t(`Image.aligns.${align}`),
              }))}
              value={(stored) =>
                typeof stored === "string" ? stored : "center"
              }
              parse={(option) => option}
            />
          </div>
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
    case "columns":
      return <ColumnsFields index={index} disabled={disabled} />;
    case "spacer":
      return (
        <BlockChoiceField
          name={`content.${index}.size`}
          label={t("Spacer.size")}
          disabled={disabled}
          options={SPACER_SIZES.map((size) => ({
            value: size,
            label: t(`Spacer.sizes.${size}`),
          }))}
          value={String}
          parse={(option) => option}
        />
      );
    case "social":
      return <SocialLinksFields index={index} disabled={disabled} />;
    case "footer":
      return (
        <BlockTextField
          name={`content.${index}.text`}
          label={t("footerText")}
          multiline
          maxLength={5000}
        />
      );
  }
}

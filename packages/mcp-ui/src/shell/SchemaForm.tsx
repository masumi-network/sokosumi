import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { t } from "./text.ts";
import { QuietButton } from "./ui.tsx";

/**
 * An agent's input schema (Masumi's `input_data` or `input_groups`), read
 * leniently: Core has already checked it with `@sokosumi/masumi`, so the form
 * reads only what it renders. Loose objects keep every other key, so the
 * parsed schema goes back to Core unchanged. Shared by the hire form and Job
 * input (SOKD-423).
 */
const Field = z.looseObject({
  id: z.string().min(1),
  type: z.string(),
  name: z.string(),
  data: z
    .looseObject({
      description: z.string().nullish(),
      placeholder: z.string().nullish(),
      label: z.string().nullish(),
      default: z.unknown(),
      value: z.string().nullish(),
      values: z.array(z.string()).nullish(),
    })
    .partial()
    .nullish(),
  validations: z
    .array(
      z.looseObject({
        validation: z.string(),
        value: z.union([z.string(), z.number()]),
      }),
    )
    .nullish(),
});
type Field = z.infer<typeof Field>;

const Grouped = z.looseObject({
  input_groups: z.array(
    z.looseObject({
      id: z.string(),
      title: z.string(),
      input_data: z.array(Field),
    }),
  ),
});
type Grouped = z.infer<typeof Grouped>;

export const InputSchema = z.union([
  z.looseObject({ input_data: z.array(Field) }),
  Grouped,
]);
export type InputSchema = z.infer<typeof InputSchema>;

/** What Core's `inputData` takes; options are indices of `data.values`, as on Web. */
export type InputValue = string | number | boolean | number[];
export type InputData = Record<string, InputValue>;

/** Form state: text while typing, booleans, and chosen option indices. */
type Draft = string | boolean | number[];

const TEXT_TYPES: Record<string, string> = {
  string: "text",
  text: "text",
  search: "search",
  email: "email",
  url: "url",
  password: "password",
  tel: "tel",
  date: "date",
  "datetime-local": "datetime-local",
  time: "time",
  month: "month",
  week: "week",
  color: "color",
  number: "number",
  range: "number",
};
const DATE_TYPES = new Set(["date", "datetime-local", "time", "month", "week"]);
const BOOLEAN_TYPES = new Set(["boolean", "checkbox"]);
const CHOICE_TYPES = new Set(["option", "radio", "multiselect"]);

const isGrouped = (schema: InputSchema): schema is Grouped =>
  Array.isArray(schema.input_groups);

function groupsOf(schema: InputSchema) {
  return isGrouped(schema)
    ? schema.input_groups.map(({ id, title, input_data }) => ({
        id,
        title,
        fields: input_data,
      }))
    : [{ id: "", title: "", fields: schema.input_data }];
}

function rule(field: Field, name: string) {
  return field.validations?.find(({ validation }) => validation === name)
    ?.value;
}
const isOptional = (field: Field) => rule(field, "optional") === "true";
const formatOf = (field: Field) => rule(field, "format");
const numberRule = (field: Field, name: string) => {
  const value = Number(rule(field, name));
  return Number.isFinite(value) ? value : undefined;
};

/** Web's rule (option-select-mode.ts): one choice unless `max` allows more. */
function isMulti(field: Field): boolean {
  if (field.type === "multiselect") return true;
  if (field.type !== "option") return false;
  const max = numberRule(field, "max");
  const min = numberRule(field, "min");
  if (max === undefined && min === undefined) return false;
  return max === undefined || max > 1;
}

function initialDraft(field: Field, given: unknown): Draft {
  const fallback = given ?? field.data?.default;
  if (BOOLEAN_TYPES.has(field.type)) return fallback === true;
  if (CHOICE_TYPES.has(field.type)) {
    if (Array.isArray(fallback)) {
      return fallback.filter((index) => typeof index === "number");
    }
    const index =
      typeof fallback === "string"
        ? (field.data?.values ?? []).indexOf(fallback)
        : -1;
    return index >= 0 ? [index] : [];
  }
  if (typeof fallback === "number") return String(fallback);
  if (typeof fallback === "string") return fallback;
  return field.type === "color" ? "#000000" : "";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEL = /^\+?[\d\s().-]{3,}$/;

function isUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** The error for one field, or its value; `undefined` leaves it out. */
function check(
  field: Field,
  draft: Draft,
): { error: string } | { value: InputValue | undefined } {
  const optional = isOptional(field);
  const min = numberRule(field, "min");
  const max = numberRule(field, "max");

  if (field.type === "hidden") return { value: field.data?.value ?? "" };
  if (field.type === "none") return { value: undefined };
  if (field.type === "file") {
    return optional
      ? { value: undefined }
      : { error: t("schemaForm.error.file") };
  }
  if (typeof draft === "boolean") return { value: draft };
  if (Array.isArray(draft)) {
    const multi = isMulti(field);
    if (draft.length === 0) {
      if (optional) return { value: undefined };
      return {
        error: multi
          ? t("schemaForm.error.chooseMin", { min: min ?? 1 })
          : t("schemaForm.error.choose"),
      };
    }
    if (multi && min !== undefined && draft.length < min) {
      return { error: t("schemaForm.error.chooseMin", { min }) };
    }
    if (multi && max !== undefined && draft.length > max) {
      return { error: t("schemaForm.error.chooseMax", { max }) };
    }
    return { value: draft };
  }

  const text = field.type === "password" ? draft : draft.trim();
  if (text === "") {
    return optional
      ? { value: undefined }
      : { error: t("schemaForm.error.required") };
  }

  if (field.type === "number" || field.type === "range") {
    const value = Number(text);
    if (!Number.isFinite(value)) return { error: t("schemaForm.error.number") };
    if (formatOf(field) === "integer" && !Number.isInteger(value)) {
      return { error: t("schemaForm.error.integer") };
    }
    if (min !== undefined && value < min) {
      return { error: t("schemaForm.error.numberMin", { min }) };
    }
    if (max !== undefined && value > max) {
      return { error: t("schemaForm.error.numberMax", { max }) };
    }
    return { value };
  }

  if (DATE_TYPES.has(field.type)) {
    // ISO dates, times, months and weeks sort as text.
    const from = rule(field, "min");
    const to = rule(field, "max");
    if (typeof from === "string" && text < from) {
      return { error: t("schemaForm.error.dateMin", { min: from }) };
    }
    if (typeof to === "string" && text > to) {
      return { error: t("schemaForm.error.dateMax", { max: to }) };
    }
    return { value: text };
  }

  const format = formatOf(field);
  if ((field.type === "email" || format === "email") && !EMAIL.test(text)) {
    return { error: t("schemaForm.error.email") };
  }
  if ((field.type === "url" || format === "url") && !isUrl(text)) {
    return { error: t("schemaForm.error.url") };
  }
  if (field.type === "tel" && !TEL.test(text)) {
    return { error: t("schemaForm.error.tel") };
  }
  if (min !== undefined && text.length < min) {
    return { error: t("schemaForm.error.textMin", { min }) };
  }
  if (max !== undefined && text.length > max) {
    return { error: t("schemaForm.error.textMax", { max }) };
  }
  return { value: text };
}

export interface SchemaFormProps {
  schema: InputSchema;
  /** Values to start from, such as the answers before going back. */
  initial?: Partial<InputData>;
  submitLabel: string;
  disabled?: boolean;
  /** Opens Sokosumi for a file field; without it the form only says so. */
  onUpload?: () => void;
  onSubmit: (data: InputData) => void;
  /** Rendered between the fields and the submit button. */
  footer?: ReactNode;
}

/**
 * An agent's input schema as accessible fields, with inline errors on submit.
 * Record text (names, descriptions, options) renders as React text.
 */
export function SchemaForm({
  schema,
  initial = {},
  submitLabel,
  disabled,
  onUpload,
  onSubmit,
  footer,
}: SchemaFormProps) {
  const groups = groupsOf(schema);
  const fields = groups.flatMap((group) => group.fields);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.id, initialDraft(field, initial[field.id])]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();

  const set = (id: string, draft: Draft) =>
    setDrafts((previous) => ({ ...previous, [id]: draft }));

  // Hosts sandbox views without `allow-forms`, so a form never submits:
  // the button and Enter in a single-line field run this instead.
  const submit = () => {
    if (disabled) return;
    const found: Record<string, string> = {};
    const data: InputData = {};
    for (const field of fields) {
      const result = check(field, drafts[field.id] ?? "");
      if ("error" in result) found[field.id] = result.error;
      else if (result.value !== undefined) data[field.id] = result.value;
    }
    setErrors(found);
    const first = fields.find((field) => found[field.id]);
    if (first) {
      formRef.current
        ?.querySelector<HTMLElement>(`[data-field="${CSS.escape(first.id)}"]`)
        ?.focus();
      return;
    }
    onSubmit(data);
  };

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          !["checkbox", "radio"].includes(event.target.type)
        ) {
          event.preventDefault();
          submit();
        }
      }}
      className="flex flex-col gap-5"
    >
      {groups.map((group) => {
        const body = group.fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            draft={drafts[field.id] ?? ""}
            error={errors[field.id]}
            idPrefix={`${formId}-${field.id}`}
            onChange={(draft) => set(field.id, draft)}
            onUpload={onUpload}
          />
        ));
        return group.title ? (
          <fieldset key={group.id} className="flex flex-col gap-5">
            <legend className="mb-1 text-sm font-semibold">
              {group.title}
            </legend>
            {body}
          </fieldset>
        ) : (
          body
        );
      })}
      {footer}
      <QuietButton
        onClick={submit}
        disabled={disabled}
        className="border-border w-full border sm:w-auto sm:self-start"
      >
        {submitLabel}
      </QuietButton>
    </form>
  );
}

const CONTROL =
  "border-input bg-background focus-visible:outline-ring min-h-11 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-1 aria-[invalid=true]:border-destructive";

function FieldRow({
  field,
  draft,
  error,
  idPrefix,
  onChange,
  onUpload,
}: {
  field: Field;
  draft: Draft;
  error?: string;
  idPrefix: string;
  onChange: (draft: Draft) => void;
  onUpload?: () => void;
}) {
  const description = field.data?.description;
  const descriptionId = `${idPrefix}-description`;
  const errorId = `${idPrefix}-error`;
  const describedBy =
    [description && descriptionId, error && errorId]
      .filter(Boolean)
      .join(" ") || undefined;
  const optional = isOptional(field);

  if (field.type === "hidden") return null;
  if (field.type === "none") {
    return <p className="text-muted-foreground text-sm">{field.name}</p>;
  }

  const label = (
    <span className="flex items-baseline gap-2 text-sm font-medium">
      {field.name}
      {optional && (
        <span className="text-muted-foreground text-xs font-normal">
          {t("schemaForm.optional")}
        </span>
      )}
    </span>
  );
  const notes = (
    <>
      {description && (
        <span id={descriptionId} className="text-muted-foreground text-xs">
          {description}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-destructive text-xs font-medium">
          {error}
        </span>
      )}
    </>
  );

  if (field.type === "file") {
    return (
      <div
        tabIndex={-1}
        data-field={field.id}
        aria-describedby={describedBy}
        className="focus-visible:outline-ring flex flex-col gap-1 rounded-md focus-visible:outline-2"
      >
        {label}
        {notes}
        {onUpload ? (
          <QuietButton onClick={onUpload} className="-mx-3 self-start">
            {t("schemaForm.upload")}
          </QuietButton>
        ) : (
          <span className="text-muted-foreground text-xs">
            {t("schemaForm.uploadText")}
          </span>
        )}
      </div>
    );
  }

  if (typeof draft === "boolean") {
    return (
      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            data-field={field.id}
            checked={draft}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.checked)}
            className="accent-foreground size-4"
          />
          {field.data?.label || field.name ? (
            <span className="text-sm font-medium">
              {field.data?.label || field.name}
            </span>
          ) : null}
        </label>
        {notes}
      </div>
    );
  }

  if (Array.isArray(draft)) {
    const values = field.data?.values ?? [];
    const multi = isMulti(field);
    if (!multi && field.type === "option") {
      return (
        <label className="flex flex-col gap-1">
          {label}
          <select
            data-field={field.id}
            value={draft[0] ?? ""}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) =>
              onChange(
                event.target.value === "" ? [] : [Number(event.target.value)],
              )
            }
            className={CONTROL}
          >
            <option value="">
              {field.data?.placeholder || t("schemaForm.choose")}
            </option>
            {values.map((value, index) => (
              <option key={value} value={index}>
                {value}
              </option>
            ))}
          </select>
          {notes}
        </label>
      );
    }
    return (
      <fieldset
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="flex flex-col gap-1"
      >
        <legend className="contents">{label}</legend>
        {notes}
        <div className="flex flex-col">
          {values.map((value, index) => {
            const checked = draft.includes(index);
            return (
              <label key={value} className="flex min-h-11 items-center gap-3">
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={idPrefix}
                  data-field={index === 0 ? field.id : undefined}
                  checked={checked}
                  onChange={() =>
                    onChange(
                      multi
                        ? checked
                          ? draft.filter((chosen) => chosen !== index)
                          : [...draft, index].sort((a, b) => a - b)
                        : [index],
                    )
                  }
                  className="accent-foreground size-4"
                />
                <span className="text-sm">{value}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const control = {
    "data-field": field.id,
    value: draft,
    placeholder: field.data?.placeholder ?? undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: CONTROL,
  };
  return (
    <label className="flex flex-col gap-1">
      {label}
      {field.type === "textarea" ? (
        <textarea
          {...control}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          {...control}
          type={TEXT_TYPES[field.type] ?? "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          autoComplete={field.type === "password" ? "off" : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {notes}
    </label>
  );
}

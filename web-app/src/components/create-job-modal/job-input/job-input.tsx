import { Button } from "@react-email/components";
import { CloudUpload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { ControllerRenderProps, UseFormReturn } from "react-hook-form";

import MultipleSelect from "@/components/multiple-select";
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  JobInputSchemaType,
  JobInputsFormSchemaType,
  ValidJobInputTypes,
} from "@/lib/job-input";

import {
  isOptional,
  isSingleOption,
  transformJobInputFileSchema,
} from "./util";

interface JobInputProps {
  form: UseFormReturn<JobInputsFormSchemaType>;
  jobInputSchema: JobInputSchemaType;
  disabled?: boolean;
}

export default function JobInput({
  form,
  jobInputSchema,
  disabled = false,
}: JobInputProps) {
  const { id, name, data } = jobInputSchema;
  return (
    <FormField
      control={form.control}
      name={id}
      disabled={disabled}
      render={({ field }) => (
        <FormItem>
          <FormLabel
            htmlFor={id}
          >{`${name} ${isOptional(jobInputSchema) ? "" : "*"}`}</FormLabel>
          <FormControl>
            <InputField
              id={id}
              field={field}
              jobInputSchema={jobInputSchema}
              form={form}
            />
          </FormControl>
          {data?.description && (
            <FormDescription>{data.description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

interface InputFieldProps {
  id: string;
  jobInputSchema: JobInputSchemaType;
  field: ControllerRenderProps<JobInputsFormSchemaType>;
  form: UseFormReturn<JobInputsFormSchemaType>;
}

function InputField({ id, field, jobInputSchema, form }: InputFieldProps) {
  const { type, data } = jobInputSchema;
  const t = useTranslations("Library.JobInput.Form");

  if (type === ValidJobInputTypes.STRING)
    return (
      <Input
        id={id}
        placeholder={data?.placeholder}
        type="text"
        {...field}
        value={typeof field.value === "string" ? field.value : ""}
      />
    );

  if (type === ValidJobInputTypes.TEXTAREA)
    return (
      <Textarea
        id={id}
        placeholder={data?.placeholder}
        {...field}
        value={typeof field.value === "string" ? field.value : ""}
      />
    );

  if (type === ValidJobInputTypes.NUMBER)
    return (
      <Input
        id={id}
        placeholder={data?.placeholder}
        type="number"
        {...field}
        value={Number(field.value).toString()}
      />
    );

  if (type === ValidJobInputTypes.BOOLEAN)
    return (
      <Switch
        id={id}
        checked={typeof field.value === "boolean" ? field.value : false}
        onCheckedChange={field.onChange}
        disabled={field.disabled}
      />
    );

  if (type === ValidJobInputTypes.OPTION) {
    const isSingle = isSingleOption(jobInputSchema);
    const {
      name,
      data: { values },
    } = jobInputSchema;

    if (isSingle) {
      return (
        <Select
          value={
            Array.isArray(field.value) && typeof field.value[0] === "number"
              ? values[field.value[0]]
              : ""
          }
          onValueChange={(value) => field.onChange([values.indexOf(value)])}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>{name}</SelectLabel>
              {values.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      );
    } else {
      return (
        <MultipleSelect
          name={name}
          value={
            Array.isArray(field.value)
              ? field.value
                  .filter((index) => typeof index === "number")
                  .map((index) => values[index])
              : []
          }
          onChange={(optionValues) =>
            field.onChange(
              optionValues
                .map((optionValue) => values.indexOf(optionValue))
                .sort(),
            )
          }
          options={values}
          className="w-full"
        />
      );
    }
  }

  if (type === ValidJobInputTypes.FILE) {
    const transformedValidations = transformJobInputFileSchema(jobInputSchema);

    return (
      <FileUpload
        id={id}
        value={(field.value as File[]) ?? []}
        onValueChange={field.onChange}
        accept={transformedValidations.accept.toString()}
        maxSize={Number(transformedValidations.maxSize)}
        maxFiles={Number(transformedValidations.max)}
        multiple={Number(transformedValidations.max) > 1}
        onFileReject={(_, message) => {
          form.setError(id, {
            message,
          });
        }}
      >
        <FileUploadDropzone className="flex-row flex-wrap border-dotted text-center">
          <FileUploadTrigger asChild>
            <Button className="cursor-pointer p-0">
              <span className="flex flex-row items-center gap-2">
                <CloudUpload className="size-4" />
                {t("File.description")}
              </span>
            </Button>
          </FileUploadTrigger>
        </FileUploadDropzone>
        <FileUploadList>
          {Array.isArray(field.value) &&
            field.value
              .filter((file): file is File => file instanceof File)
              .map((file, index) => (
                <FileUploadItem key={index} value={file}>
                  <FileUploadItemPreview />
                  <FileUploadItemMetadata />
                  <FileUploadItemDelete asChild>
                    <Button className="size-7 cursor-pointer">
                      <X />
                      <span className="sr-only">{t("File.delete")}</span>
                    </Button>
                  </FileUploadItemDelete>
                </FileUploadItem>
              ))}
        </FileUploadList>
      </FileUpload>
    );
  }

  if (type === ValidJobInputTypes.NONE) return null;
}

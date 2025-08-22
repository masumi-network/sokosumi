import { Button } from "@react-email/components";
import { CloudUpload, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { transformJobInputFileSchema } from "@/components/create-job-modal/job-input/util";
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
import { JobInputFileSchemaType } from "@/lib/job-input";

import { JobInputComponentProps } from "./types";

export function FileInput({
  id,
  field,
  jobInputSchema,
  form,
}: JobInputComponentProps) {
  const t = useTranslations("Library.JobInput.Form");

  const transformedValidations = transformJobInputFileSchema(
    jobInputSchema as JobInputFileSchemaType,
  );

  const isSubmitting = form.formState.isSubmitting;

  return (
    <FileUpload
      id={id}
      value={(field.value as File[]) ?? []}
      onValueChange={field.onChange}
      disabled={isSubmitting}
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
      <FileUploadDropzone
        className={`flex-row flex-wrap border-dotted text-center ${
          isSubmitting ? "opacity-50" : ""
        }`}
      >
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
                {!isSubmitting && (
                  <FileUploadItemDelete asChild>
                    <Button className="size-7 cursor-pointer">
                      <X />
                      <span className="sr-only">{t("File.delete")}</span>
                    </Button>
                  </FileUploadItemDelete>
                )}
              </FileUploadItem>
            ))}
      </FileUploadList>
    </FileUpload>
  );
}

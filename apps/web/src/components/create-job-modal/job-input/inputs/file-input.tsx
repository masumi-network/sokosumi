import { InputFileSchemaType } from "@sokosumi/masumi/schemas";
import { InputType } from "@sokosumi/masumi/types";
import { CloudUpload, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { transformJobInputSchemaValidations } from "@/components/create-job-modal/job-input/util";
import { Button } from "@/components/ui/button";
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

import { JobInputComponentProps } from "./types";

export function FileInput({
  id,
  field,
  jobInputSchema,
  form,
}: JobInputComponentProps<InputType.FILE, InputFileSchemaType>) {
  const t = useTranslations("Library.JobInput.Form");

  const transformedValidations = useMemo(
    () => transformJobInputSchemaValidations(jobInputSchema),
    [jobInputSchema],
  );

  const isSubmitting = form.formState.isSubmitting;
  const maxFiles = Number(transformedValidations.max ?? 1);
  const currentFiles = (field.value as File[]) ?? [];

  return (
    <FileUpload
      id={id}
      value={currentFiles}
      onValueChange={field.onChange}
      disabled={isSubmitting}
      accept={transformedValidations.accept?.toString()}
      maxFiles={maxFiles}
      multiple={maxFiles > 1}
      onFileReject={(_, message) => {
        form.setError(id, {
          message,
        });
      }}
    >
      {currentFiles.length < maxFiles && (
        <FileUploadDropzone
          className={`flex-row flex-wrap border-dotted text-center ${
            isSubmitting ? "opacity-50" : ""
          }`}
        >
          <FileUploadTrigger asChild>
            <Button
              variant="ghost"
              className="cursor-pointer p-0 hover:bg-transparent! hover:text-current!"
            >
              <span className="flex flex-row items-center gap-2">
                <CloudUpload className="size-4" />
                {t("File.description")}
              </span>
            </Button>
          </FileUploadTrigger>
        </FileUploadDropzone>
      )}
      <FileUploadList>
        {currentFiles
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

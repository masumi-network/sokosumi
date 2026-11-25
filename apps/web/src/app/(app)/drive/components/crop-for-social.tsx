"use client";

import { driveFolderPathFromSourceId } from "@sokosumi/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Crop, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CROP_MAX_BYTES,
  croppedFileName,
  croppedType,
  cropRect,
  isCroppableImage,
  SOCIAL_SHAPES,
  type SocialShapeId,
} from "@/app/drive/components/crop-for-social.utils";
import { effectiveType } from "@/app/drive/components/drive-file-preview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toolbarButtonClassName } from "@/components/ui/image-viewer";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { invalidateDrive, normalizeDriveStore } from "@/queries/drive";

const KEY_STEP = 0.05;

/**
 * Crop a Files image to a shape a social network asks for and save the copy
 * beside the original. The original is never changed.
 *
 * The bytes are read through the app's authorized same-origin route, so the
 * canvas can export them.
 */
export function CropForSocial({
  pathname,
  name,
  mimeType,
  sizeBytes,
  store,
}: {
  pathname: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  store: FileStore;
}) {
  const t = useTranslations("App.Drive.Crop");
  const [open, setOpen] = useState(false);
  const type = effectiveType(mimeType, name);
  if (!isCroppableImage(type)) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          aria-label={t("open")}
          title={t("open")}
          className={toolbarButtonClassName}
          size="icon"
          variant="ghost"
        >
          <Crop className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      {open ? (
        <CropDialogContent
          pathname={pathname}
          name={name}
          type={type}
          tooLarge={sizeBytes !== null && sizeBytes > CROP_MAX_BYTES}
          store={store}
          onSaved={() => setOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}

function CropDialogContent({
  pathname,
  name,
  type,
  tooLarge,
  store,
  onSaved,
}: {
  pathname: string;
  name: string;
  type: string;
  tooLarge: boolean;
  store: FileStore;
  onSaved: () => void;
}) {
  const t = useTranslations("App.Drive.Crop");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ start: number; position: number } | null>(null);
  const [shapeId, setShapeId] = useState<SocialShapeId>("square");
  const [position, setPosition] = useState(0.5);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const shape =
    SOCIAL_SHAPES.find((entry) => entry.id === shapeId) ?? SOCIAL_SHAPES[0];
  const rect = size ? cropRect(size.width, size.height, shape, position) : null;
  const source = `/api/drive/content?${new URLSearchParams({ pathname })}`;
  const problem = tooLarge ? t("tooLarge") : failed ? t("loadError") : null;

  function move(next: number) {
    setPosition(Math.min(1, Math.max(0, next)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = {
      ArrowLeft: -KEY_STEP,
      ArrowUp: -KEY_STEP,
      ArrowRight: KEY_STEP,
      ArrowDown: KEY_STEP,
    };
    if (event.key === "Home") move(0);
    else if (event.key === "End") move(1);
    else if (event.key in steps) move(position + (steps[event.key] ?? 0));
    else return;
    event.preventDefault();
  }

  /** The frame's free travel on screen along its axis, in CSS pixels. */
  function travelOf(stage: HTMLElement): number {
    if (!rect?.axis || !size) return 0;
    const box = stage.getBoundingClientRect();
    return rect.axis === "x"
      ? box.width * (1 - rect.width / size.width)
      : box.height * (1 - rect.height / size.height);
  }

  /**
   * A press on the frame drags it; a press beside it first centres the frame
   * there, so a tap places the crop without dragging (WCAG 2.5.7).
   */
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!rect?.axis || !size) return;
    const stage = event.currentTarget;
    const travel = travelOf(stage);
    if (travel <= 0) return;
    const at = rect.axis === "x" ? event.clientX : event.clientY;
    let start = position;
    if (event.target === stage || event.target === imageRef.current) {
      const box = stage.getBoundingClientRect();
      const frame =
        rect.axis === "x"
          ? (box.width * rect.width) / size.width
          : (box.height * rect.height) / size.height;
      const origin = rect.axis === "x" ? box.left : box.top;
      start = Math.min(1, Math.max(0, (at - origin - frame / 2) / travel));
      setPosition(start);
    }
    stage.setPointerCapture(event.pointerId);
    dragRef.current = { start: at, position: start };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !rect?.axis) return;
    const travel = travelOf(event.currentTarget);
    if (travel <= 0) return;
    const now = rect.axis === "x" ? event.clientX : event.clientY;
    move(drag.position + (now - drag.start) / travel);
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  async function save() {
    const image = imageRef.current;
    if (!image || !rect) return;
    const fileName = croppedFileName(name, shape, type);
    setSaving(true);
    try {
      const outputType = croppedType(type);
      const canvas = document.createElement("canvas");
      canvas.width = rect.width;
      canvas.height = rect.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas");
      context.drawImage(
        image,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outputType, 0.92),
      );
      if (!blob) throw new Error("No image");
      const folder = driveFolderPathFromSourceId(pathname);
      await uploadDriveFile(new File([blob], fileName, { type: outputType }), {
        ...normalizeDriveStore(store),
        ...(folder ? { folder } : {}),
      });
      void invalidateDrive(queryClient, store);
      toast.success(t("saved", { name: fileName }));
      onSaved();
    } catch (error) {
      toast.error(
        isDriveFileUploadDuplicate(error)
          ? t("duplicate", { name: fileName })
          : t("saveError"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent className="max-h-[92dvh] overflow-y-auto overscroll-contain sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <RadioGroup
        value={shapeId}
        onValueChange={(value) => {
          setShapeId(value as SocialShapeId);
          setPosition(0.5);
        }}
        aria-label={t("shapeLabel")}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {SOCIAL_SHAPES.map((entry) => (
          <label
            key={entry.id}
            className="has-[button[data-state=checked]]:border-foreground flex min-h-11 cursor-pointer items-start gap-2 rounded-md border p-2"
          >
            <RadioGroupItem value={entry.id} className="mt-0.5" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">
                {t(`shapes.${entry.id}.name`)}
              </span>
              <span className="text-muted-foreground text-xs">
                {t(`shapes.${entry.id}.hint`)}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>

      <div className="bg-muted flex min-h-48 items-center justify-center rounded-md p-2">
        {problem ? (
          <p role="alert" className="text-muted-foreground text-sm">
            {problem}
          </p>
        ) : (
          <div
            className="relative w-fit touch-none overflow-hidden rounded-sm"
            data-testid="crop-stage"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Not next/image: authorized same-origin bytes the canvas reads. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={source}
              alt={name}
              draggable={false}
              className="block max-h-[50dvh] max-w-full select-none"
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              onError={() => setFailed(true)}
            />
            {rect && size ? (
              <div
                role="slider"
                tabIndex={0}
                aria-label={t("frameLabel")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(position * 100)}
                aria-valuetext={format.number(position, {
                  style: "percent",
                  maximumFractionDigits: 0,
                })}
                aria-orientation={rect.axis === "y" ? "vertical" : "horizontal"}
                aria-disabled={rect.axis === null || undefined}
                data-testid="crop-frame"
                className="focus-visible:ring-ring absolute cursor-grab border-2 border-on-media outline-solid outline-[9999px] outline-scrim-strong focus-visible:ring-2 active:cursor-grabbing aria-disabled:cursor-default"
                style={{
                  left: `${(rect.x / size.width) * 100}%`,
                  top: `${(rect.y / size.height) * 100}%`,
                  width: `${(rect.width / size.width) * 100}%`,
                  height: `${(rect.height / size.height) * 100}%`,
                }}
                onKeyDown={handleKeyDown}
              />
            ) : (
              <Loader2
                className="text-on-media absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 animate-spin motion-reduce:animate-pulse"
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </div>

      {problem ? null : (
        <p className="text-muted-foreground text-xs tabular-nums">
          {rect
            ? t("result", {
                name: croppedFileName(name, shape, type),
                width: rect.width,
                height: rect.height,
              })
            : t("loading")}
        </p>
      )}

      <DialogFooter>
        <Button
          type="button"
          loading={saving}
          disabled={!rect || saving || problem !== null}
          onClick={() => void save()}
        >
          {t("save")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

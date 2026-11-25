"use client";

import { driveFolderPathFromSourceId } from "@sokosumi/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Crop, Loader2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { RadioGroup } from "radix-ui";
import { type PointerEvent, type RefObject, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CROP_MAX_BYTES,
  type CropRect,
  croppedFileName,
  croppedType,
  cropRect,
  dragPosition,
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
import { cn } from "@/lib/utils";
import {
  isDriveFileUploadDuplicate,
  uploadDriveFile,
} from "@/lib/utils/drive-file-upload.client";
import type { FileStore } from "@/lib/utils/file-search.client";
import { invalidateDrive, normalizeDriveStore } from "@/queries/drive";

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

  async function save() {
    const image = imageRef.current;
    if (!image || !rect) return;
    const fileName = croppedFileName(name, shape, type);
    setSaving(true);
    try {
      const file = await cropToFile(image, rect, fileName, croppedType(type));
      const folder = driveFolderPathFromSourceId(pathname);
      await uploadDriveFile(file, {
        ...normalizeDriveStore(store),
        ...(folder ? { folder } : {}),
      });
      void invalidateDrive(queryClient, store);
      toast.success(t("saved", { name: fileName }));
      onSaved();
    } catch (error) {
      toast.error(t(saveErrorKey(error), { name: fileName }));
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

      <ShapePicker
        value={shapeId}
        onChange={(value) => {
          setShapeId(value);
          setPosition(0.5);
        }}
      />

      <CropStage
        source={source}
        name={name}
        problem={problem}
        imageRef={imageRef}
        rect={rect}
        size={size}
        position={position}
        onPosition={setPosition}
        onSize={setSize}
        onError={() => setFailed(true)}
      />

      {rect?.axis && !problem ? (
        // Tap anywhere on the track to place the crop; no drag needed (WCAG 2.5.7).
        <input
          type="range"
          className="accent-foreground h-10 w-full cursor-pointer"
          min={0}
          max={100}
          step={1}
          value={Math.round(position * 100)}
          onChange={(event) => setPosition(event.target.valueAsNumber / 100)}
          aria-label={t(rect.axis === "x" ? "positionX" : "positionY")}
          aria-valuetext={format.number(position, {
            style: "percent",
            maximumFractionDigits: 0,
          })}
        />
      ) : null}

      {problem ? null : (
        <p className="text-muted-foreground text-xs">
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

/** Draws the crop to a canvas and returns it as an image file. */
async function cropToFile(
  image: HTMLImageElement,
  rect: CropRect,
  fileName: string,
  type: string,
): Promise<File> {
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
    canvas.toBlob(resolve, type, 0.92),
  );
  if (!blob) throw new Error("No image");
  return new File([blob], fileName, { type });
}

function saveErrorKey(error: unknown): "duplicate" | "tooLarge" | "saveError" {
  if (isDriveFileUploadDuplicate(error)) return "duplicate";
  // A stale size let a signed-storage image through: the canvas refuses it.
  if (error instanceof DOMException && error.name === "SecurityError") {
    return "tooLarge";
  }
  return "saveError";
}

function ShapePicker({
  value,
  onChange,
}: {
  value: SocialShapeId;
  onChange: (value: SocialShapeId) => void;
}) {
  const t = useTranslations("App.Drive.Crop");
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as SocialShapeId)}
      aria-label={t("shapeLabel")}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {SOCIAL_SHAPES.map((entry) => (
        // The whole card is the radio, so its tap target and name are the card's.
        <RadioGroup.Item
          key={entry.id}
          value={entry.id}
          className="press focus-visible:ring-ring data-[state=checked]:border-foreground flex min-h-11 flex-col rounded-md border p-2 text-start outline-none focus-visible:ring-2 data-[state=checked]:inset-ring-1 data-[state=checked]:inset-ring-foreground"
        >
          <span className="text-sm font-medium">
            {t(`shapes.${entry.id}.name`)}
          </span>
          <span className="text-muted-foreground text-xs">
            {t(`shapes.${entry.id}.hint`)}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

function CropStage({
  source,
  name,
  problem,
  imageRef,
  rect,
  size,
  position,
  onPosition,
  onSize,
  onError,
}: {
  source: string;
  name: string;
  problem: string | null;
  imageRef: RefObject<HTMLImageElement | null>;
  rect: CropRect | null;
  size: { width: number; height: number } | null;
  position: number;
  onPosition: (position: number) => void;
  onSize: (size: { width: number; height: number }) => void;
  onError: () => void;
}) {
  const drag = useRef<{ at: number; position: number } | null>(null);
  const axis = rect?.axis ?? null;

  /** The pointer and the frame as fractions along the frame's axis. */
  function measure(event: PointerEvent<HTMLDivElement>) {
    if (!rect || !size || !axis) return null;
    const box = event.currentTarget.getBoundingClientRect();
    return axis === "x"
      ? {
          at: (event.clientX - box.left) / box.width,
          from: rect.x / size.width,
          frame: rect.width / size.width,
        }
      : {
          at: (event.clientY - box.top) / box.height,
          from: rect.y / size.height,
          frame: rect.height / size.height,
        };
  }

  // Direct framing for pointers; the slider below stays the keyboard and
  // single-tap way to do the same (WCAG 2.5.7).
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const at = measure(event);
    if (!at || event.button !== 0) return;
    const grabbed = at.at >= at.from && at.at <= at.from + at.frame;
    const next = grabbed ? position : dragPosition({ ...at, start: null });
    drag.current = { at: at.at, position: next };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onPosition(next);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const at = measure(event);
    if (!at || !drag.current) return;
    onPosition(dragPosition({ ...at, start: drag.current }));
  }

  function endDrag() {
    drag.current = null;
  }

  return (
    <div className="bg-muted flex min-h-48 items-center justify-center rounded-md p-2">
      {problem ? (
        <p role="alert" className="text-muted-foreground text-sm">
          {problem}
        </p>
      ) : (
        <div
          className={cn(
            "relative w-fit overflow-hidden rounded-sm",
            // Keep the other axis free so the dialog still scrolls on touch.
            axis === "x" && "cursor-grab touch-pan-y active:cursor-grabbing",
            axis === "y" && "cursor-grab touch-pan-x active:cursor-grabbing",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
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
              onSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={onError}
          />
          {rect && size ? (
            <div
              aria-hidden="true"
              data-testid="crop-frame"
              className="absolute border-2 border-on-media outline-solid outline-[9999px] outline-scrim-strong"
              style={{
                left: `${(rect.x / size.width) * 100}%`,
                top: `${(rect.y / size.height) * 100}%`,
                width: `${(rect.width / size.width) * 100}%`,
                height: `${(rect.height / size.height) * 100}%`,
              }}
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
  );
}

"use client";

import {
  createContext,
  use,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { cn } from "@/lib/utils";

type ImageLoadingStatus = "idle" | "loading" | "loaded" | "error";

interface AvatarContextValue {
  imageStatus: ImageLoadingStatus;
  setImageStatus: (status: ImageLoadingStatus) => void;
}

const AvatarContext = createContext<AvatarContextValue | null>(null);

function Avatar({ className, ...props }: ComponentProps<"span">) {
  const [imageStatus, setImageStatus] = useState<ImageLoadingStatus>("idle");

  return (
    <AvatarContext value={{ imageStatus, setImageStatus }}>
      <span
        data-slot="avatar"
        className={cn(
          "relative flex size-8 shrink-0 overflow-hidden rounded-full",
          className,
        )}
        {...props}
      />
    </AvatarContext>
  );
}

interface AvatarImageProps extends ComponentProps<"img"> {
  onLoadingStatusChange?: (status: ImageLoadingStatus) => void;
}

function AvatarImage({
  className,
  src,
  alt = "",
  onLoadingStatusChange,
  referrerPolicy,
  crossOrigin,
  ...props
}: AvatarImageProps) {
  const context = use(AvatarContext);
  const [status, setStatus] = useState<ImageLoadingStatus>(() =>
    typeof src === "string" && src !== "" ? "idle" : "error",
  );
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setStatus(typeof src === "string" && src !== "" ? "idle" : "error");
  }

  const onStatusRef = useRef(onLoadingStatusChange);
  const setImageStatusRef = useRef(context?.setImageStatus);
  useLayoutEffect(() => {
    onStatusRef.current = onLoadingStatusChange;
    setImageStatusRef.current = context?.setImageStatus;
  });

  useLayoutEffect(() => {
    if (typeof src !== "string" || src === "") {
      setImageStatusRef.current?.("error");
      onStatusRef.current?.("error");
      return;
    }

    let cancelled = false;
    const image = new window.Image();

    const update = (next: ImageLoadingStatus) => {
      // SOKOSUMI-S9: do not setState in this effect's cleanup. Radix reset
      // status to "idle" on unmount; that nested past React's update-depth
      // limit when chat unmounted avatar stacks (seen-by / Activity).
      if (cancelled) return;
      setStatus(next);
      setImageStatusRef.current?.(next);
      onStatusRef.current?.(next);
    };

    const handleLoad = () => {
      update(image.naturalWidth > 0 ? "loaded" : "error");
    };
    const handleError = () => {
      update("error");
    };

    image.addEventListener("load", handleLoad);
    image.addEventListener("error", handleError);
    if (referrerPolicy) {
      image.referrerPolicy = referrerPolicy;
    }
    if (crossOrigin !== undefined) {
      image.crossOrigin = crossOrigin;
    }
    image.src = src;
    update(
      image.complete
        ? image.naturalWidth > 0
          ? "loaded"
          : "error"
        : "loading",
    );

    return () => {
      cancelled = true;
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
  }, [src, referrerPolicy, crossOrigin]);

  if (status !== "loaded") {
    return null;
  }

  return (
    <img
      data-slot="avatar-image"
      src={src}
      alt={alt}
      referrerPolicy={referrerPolicy}
      crossOrigin={crossOrigin}
      className={cn("absolute inset-0 aspect-square size-full object-cover", className)}
      {...props}
    />
  );
}

interface AvatarFallbackProps extends ComponentProps<"span"> {
  delayMs?: number;
}

function AvatarFallback({
  className,
  delayMs,
  ...props
}: AvatarFallbackProps) {
  const context = use(AvatarContext);
  const [canRender, setCanRender] = useState(delayMs === undefined);

  useLayoutEffect(() => {
    if (delayMs === undefined) {
      return;
    }
    const timerId = window.setTimeout(() => setCanRender(true), delayMs);
    return () => window.clearTimeout(timerId);
  }, [delayMs]);

  if (!canRender || context?.imageStatus === "loaded") {
    return null;
  }

  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted flex size-full items-center justify-center rounded-full",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };

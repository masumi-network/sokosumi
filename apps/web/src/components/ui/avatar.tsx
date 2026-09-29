"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { cn } from "@/lib/utils";

type ImageLoadingStatus = "idle" | "loading" | "loaded" | "error";

function Avatar({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        "relative flex size-8 shrink-0 overflow-hidden rounded-full",
        className,
      )}
      {...props}
    />
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
  const [status, setStatus] = useState<ImageLoadingStatus>(() =>
    typeof src === "string" && src !== "" ? "idle" : "error",
  );
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setStatus(typeof src === "string" && src !== "" ? "idle" : "error");
  }

  const onStatusRef = useRef(onLoadingStatusChange);
  useLayoutEffect(() => {
    onStatusRef.current = onLoadingStatusChange;
  });

  useLayoutEffect(() => {
    if (typeof src !== "string" || src === "") {
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
      className={cn(
        "absolute inset-0 z-10 aspect-square size-full object-cover",
        className,
      )}
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
  const [canRender, setCanRender] = useState(delayMs === undefined);

  useLayoutEffect(() => {
    if (delayMs === undefined) {
      return;
    }
    const timerId = window.setTimeout(() => setCanRender(true), delayMs);
    return () => window.clearTimeout(timerId);
  }, [delayMs]);

  if (!canRender) {
    return null;
  }

  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted absolute inset-0 z-0 flex size-full items-center justify-center rounded-full",
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback };

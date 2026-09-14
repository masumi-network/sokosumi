import { type SyntheticEvent, useCallback } from "react";

interface ImageSize {
  width: number;
  height: number;
}

/** Natural sizes by URL, for the life of the page. */
const rememberedSizes = new Map<string, ImageSize>();

/**
 * Width and height for an `<img>` whose URL has loaded before, plus the load
 * handler that remembers them.
 *
 * A row that leaves a virtualized list and comes back renders its image
 * from scratch, at zero height until the bytes land, and grows by the whole
 * image a frame later. With the natural size on the element the browser
 * reserves the box from the first frame, so a remount costs no layout shift;
 * only the very first load of a URL still does.
 */
export function useRememberedImageSize(src: string | undefined): {
  width?: number;
  height?: number;
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
} {
  const known = src ? rememberedSizes.get(src) : undefined;
  const onLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = event.currentTarget;
      if (src && naturalWidth > 0 && naturalHeight > 0) {
        rememberedSizes.set(src, {
          width: naturalWidth,
          height: naturalHeight,
        });
      }
    },
    [src],
  );
  return { width: known?.width, height: known?.height, onLoad };
}

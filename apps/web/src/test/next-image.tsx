import type { ImageProps } from "next/image";

/**
 * `next/image` as the plain `<img>` it renders, for `vi.mock("next/image")`.
 * Its development checks measure the parent's computed position and height,
 * which happy-dom, having no layout or stylesheet, reports as "" and 0 for
 * every `fill` image. The props a browser would not see are dropped.
 *
 * vi.mock("next/image", () => import("@/test/next-image"));
 */
export default function Image({
  src,
  alt,
  fill: _fill,
  priority: _priority,
  quality: _quality,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  loader: _loader,
  unoptimized: _unoptimized,
  overrideSrc: _overrideSrc,
  onLoadingComplete: _onLoadingComplete,
  ...rest
}: ImageProps) {
  const url =
    typeof src === "string"
      ? src
      : "default" in src
        ? src.default.src
        : src.src;
  return <img alt={alt} src={url} {...rest} />;
}

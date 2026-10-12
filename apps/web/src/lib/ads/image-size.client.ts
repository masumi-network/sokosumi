"use client";

export interface ImageSize {
  width: number;
  height: number;
}

/** The picture's own size in pixels, read by loading it in the browser. */
export function readImageSize(src: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to read the image"));
    image.src = src;
  });
}

/** The size of a file the reader chose, before it is uploaded. */
export async function readFileImageSize(file: File): Promise<ImageSize> {
  const url = URL.createObjectURL(file);
  try {
    return await readImageSize(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface CapturedUpload {
  pathname: string;
  bytes: Uint8Array;
  body: string;
  contentType: string;
}

export const uploads: CapturedUpload[] = [];

export const blobStore = {
  put: async (pathname: string, file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    uploads.push({
      pathname,
      bytes,
      body: new TextDecoder().decode(bytes),
      contentType: file.type,
    });
    return { url: `https://blob.test/${pathname}` };
  },
  head: async () => ({ contentType: "text/markdown", size: 1234 }),
  del: async (url: string) => {
    const index = uploads.findIndex(
      ({ pathname }) => url === `https://blob.test/${pathname}`,
    );
    if (index < 0) throw new Error(`Missing upload: ${url}`);
    uploads.splice(index, 1);
  },
};

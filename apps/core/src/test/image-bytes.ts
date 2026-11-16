/** A real PNG header, so code that reads an image's size has one to read. */
export function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const data = new DataView(bytes.buffer);
  data.setUint32(16, width);
  data.setUint32(20, height);
  return bytes;
}

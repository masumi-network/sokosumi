/** `[0.1,0.2,…]`, the text form pgvector reads with `::vector`. */
export function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

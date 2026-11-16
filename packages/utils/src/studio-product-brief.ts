export function productBrief(product: {
  name: string;
  description: string;
  price: string;
}): string {
  return [
    `Feature one product: ${product.name.trim()}.`,
    product.description.trim(),
    product.price.trim() ? `Approved price: ${product.price.trim()}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

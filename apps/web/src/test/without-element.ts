import { Children, cloneElement, isValidElement, type ReactNode } from "react";

/**
 * The element tree with every element of `type` taken out. For rendering a
 * server shell whose async Server Component child happy-dom cannot render;
 * that child is tested on its own by awaiting it.
 */
export function withoutElement(node: ReactNode, type: unknown): ReactNode {
  // A single child stays single: `Slot` and friends expect one element.
  if (Array.isArray(node)) {
    return Children.map(node, (child) => withoutElement(child, type));
  }
  if (!isValidElement(node)) return node;
  if (node.type === type) return null;
  const { children } = node.props as { children?: ReactNode };
  return children === undefined
    ? node
    : cloneElement(node, undefined, withoutElement(children, type));
}

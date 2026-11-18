import type { ComponentProps } from "react";
import { VIEW_PATHS, type View } from "../../lib/views";

interface ViewLinkProps extends Omit<ComponentProps<"a">, "href" | "onClick"> {
  view: View;
  open: (view: View) => void;
}

/** A link to one of the app's pages, opened in place without a page load. */
export function ViewLink({ view, open, ...rest }: ViewLinkProps) {
  return (
    <a
      {...rest}
      href={VIEW_PATHS[view]}
      onClick={(event) => {
        // A modified click opens the page in a new tab as usual.
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        open(view);
      }}
    />
  );
}

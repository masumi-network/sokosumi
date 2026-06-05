import "next/script";

/**
 * Next.js `ScriptProps` extends `ScriptHTMLAttributes` as a named import from
 * `"react"`, but `@types/react` 19 exposes that type on the `React` namespace
 * only (`export = React`). TypeScript then omits standard script attributes
 * (`src`, `async`, `dangerouslySetInnerHTML`, etc.) from `ScriptProps`.
 *
 * Merge the missing DOM script attributes here until Next.js fixes the import.
 */
declare module "next/script" {
  export interface ScriptProps {
    async?: boolean;
    dangerouslySetInnerHTML?: { __html: string };
    src?: string;
  }
}

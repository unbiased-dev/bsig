import type { BsProps, ComponentFn } from './runtime.js';

/** Automatic JSX runtime: `jsxImportSource: "bsig"` in tsconfig. */
export function jsx(
  tag: string | ComponentFn | null,
  props: (BsProps & { key?: unknown }) | null,
  key?: unknown
): any;
export const jsxs: typeof jsx;
/** Use as <></>: resolves through h(null, …) into a fragment. */
export const Fragment: null;

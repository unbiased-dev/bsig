/**
 * Types for the bsig Vite plugin (`bsig/plugin`).
 * Self-contained on purpose: no `vite` import, so these resolve even when
 * only the plugin entry is loaded. The returned object is structurally
 * assignable to Vite's `Plugin` (pre-enforced JSX transform).
 */
export interface BsigOptions {
  /**
   * Force the `h` auto-import to resolve to this runtime file instead of
   * the `bsig` package specifier. Resolved against the importing file, so
   * use an absolute path or one relative to the project root, e.g.
   * `bsig({ runtime: './src/runtime.js' })`.
   */
  runtime?: string;
}

export interface BsigTransformResult {
  code: string;
  map: null;
}

export interface BsigPlugin {
  name: 'vite-plugin-bsig';
  enforce: 'pre';
  transform(code: string, id: string): Promise<BsigTransformResult | null>;
}

export default function bsig(opts?: BsigOptions): BsigPlugin;

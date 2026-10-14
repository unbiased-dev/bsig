// bsig automatic JSX runtime (`jsxImportSource: "bsig"`).
// Used by tsc/esbuild for *types and fallback builds*; the bsig Vite plugin
// still compiles JSX to thunks + h() ahead of time, so this shapes the
// type surface more than the hot path. Single shared instance via './runtime.js'
// (internal to the package — always consistent, unlike consumer files).
import { h } from './runtime.js';

// jsx(type, config): children arrive inside config (config.children),
// which h() already honors — key is framework-internal, don't render it.
export const jsx = (tag, config) => {
  if (!config) return h(tag, null);
  const { key, ...props } = config;
  return h(tag, props);
};
export const jsxs = jsx;
export const Fragment = null;

// bsig automatic JSX runtime (`jsxImportSource: "bsig"`).
// Used by tsc/esbuild for *types and fallback builds*; the bsig Vite plugin
// still compiles JSX to thunks + h() ahead of time, so this shapes the
// type surface more than the hot path. Single shared instance via './runtime.js'
// (internal to the package — always consistent, unlike consumer files).
import { h } from './runtime.js';

// jsx(type, config): children arrive inside config (config.children),
// which h() already honors — key is framework-internal, don't render it.
// Extra dev-mode args (isStaticChildren, source, self) are ignored.
export const jsx = (tag, config) => {
  if (!config) return h(tag, null);
  const { key, ...props } = config;
  return h(tag, props);
};
export const jsxs = jsx;
// Dev-mode JSX (non-production bun builds, Vite dev dep-scan) imports
// jsxDEV(type, config, maybeKey, isStaticChildren, source, self).
// Same behavior: extra args are irrelevant to h().
export const jsxDEV = jsx;
export const Fragment = null;

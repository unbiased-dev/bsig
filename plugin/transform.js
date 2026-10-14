import { transformAsync } from '@babel/core';
import jsxTransform from '@babel/plugin-transform-react-jsx';
import tsTransform from '@babel/plugin-transform-typescript';
import path from 'node:path';

const toPosix = (p) => p.split(path.sep).join('/');

// Auto-thunk: wraps dynamic JSX expressions in () => ... so the
// runtime sees a function (dynamic zone) instead of a read-once value.
// Skips event props (on*), ref, and already-function expressions.
function autoThunkPlugin({ types: t }) {
  const isFnNode = (n) =>
    t.isArrowFunctionExpression(n) ||
    t.isFunctionExpression(n) ||
    t.isFunctionDeclaration(n);

  return {
    visitor: {
      // `<Show>` mounts/unmounts its children on every toggle, but JSX
      // evaluates element children eagerly, so a component child would be
      // built once and reused. Its effects are stopped on removal and never
      // revived, leaving the re-shown subtree frozen. Hand Show its children
      // as thunks so each activation rebuilds them (same shape the plugin
      // already produces for `{...}` expression children).
      JSXElement(path) {
        const name = path.node.openingElement.name;
        if (!t.isJSXIdentifier(name) || name.name !== 'Show') return;
        path.node.children = path.node.children.map((child) =>
          t.isJSXElement(child) || t.isJSXFragment(child)
            ? t.jsxExpressionContainer(t.arrowFunctionExpression([], child))
            : child,
        );
      },
      JSXAttribute(path) {
        const name = path.node.name?.name;
        if (!name || typeof name !== 'string') return;
        if (name.startsWith('on') || name === 'ref' || name === 'key') return;
        const val = path.node.value;
        if (val && t.isJSXExpressionContainer(val)) {
          const expr = val.expression;
          if (!expr || t.isJSXEmptyExpression(expr)) return;
          if (isFnNode(expr)) return;
          // static literals stay static: "text", 50, true
          if (
            t.isStringLiteral(expr) ||
            t.isNumericLiteral(expr) ||
            t.isBooleanLiteral(expr) ||
            t.isNullLiteral(expr)
          ) return;
          val.expression = t.arrowFunctionExpression([], expr);
        }
      },
      JSXExpressionContainer(path) {
        // handled via JSXAttribute above
        if (t.isJSXAttribute(path.parent)) return;
        // only children of elements/fragments
        if (!t.isJSXElement(path.parent) && !t.isJSXFragment(path.parent)) return;
        const expr = path.node.expression;
        if (!expr || t.isJSXEmptyExpression(expr)) return;
        if (isFnNode(expr)) return;
        // keep JSX elements static if they contain no dynamic work?
        // For the demo we wrap everything non-function: cheap, speed is secondary.
        // Skip null/undefined/false/true/strings/numbers (static text).
        if (
          t.isStringLiteral(expr) ||
          t.isNumericLiteral(expr) ||
          t.isBooleanLiteral(expr) ||
          t.isNullLiteral(expr)
        ) return;
        // For()/If() already return stable thunks with internal caches.
        // Wrapping them would re-invoke the helper on every update,
        // resetting the key cache and turning moves/removes into
        // destroy + recreate. Leave them unwrapped.
        if (
          t.isCallExpression(expr) &&
          t.isIdentifier(expr.callee) &&
          (expr.callee.name === 'For' || expr.callee.name === 'If')
        ) return;
        path.node.expression = t.arrowFunctionExpression([], expr);
      },
    },
  };
}

// Shared by the Vite plugin (bsig-jsx.js) and the Bun plugin (bun.js).
// Returns { code, map } or null when the file needs no transform.
export async function transformBsig(code, filename, opts = {}) {
  const cleanId = filename.split('?')[0];
  // .tsx needs the TS syntax transform too; plain .ts has no JSX.
  const isTsx = cleanId.endsWith('.tsx');
  if (!cleanId.endsWith('.jsx') && !isTsx) return null;
  // skip runtime + plugins themselves (no JSX there anyway)
  if (cleanId.endsWith('runtime.js') || cleanId.includes('bsig-jsx')) return null;
  if (!code.includes('<')) return null;
  const result = await transformAsync(code, {
    filename: cleanId,
    presets: [],
    plugins: [
      autoThunkPlugin,
      [jsxTransform, { pragma: 'h', pragmaFrag: 'null' }],
      ...(isTsx ? [[tsTransform, { isTSX: true, allExtensions: true }]] : []),
    ],
    ast: false,
    code: true,
    babelrc: false,
    configFile: false,
  });
  if (!result?.code) return null;
  let out = result.code;
  // Auto-import h when the output actually calls it and nothing in scope
  // provides it. Done post-transform (not pre-) because the TS pass
  // elides imports before the JSX pass creates the h() references.
  // Package specifier, never relative: every file must resolve to the
  // SAME runtime instance (a relative default once caused a dual-runtime
  // bug where signals updated but the DOM never did).
  const usesH = /(?<!\.)\bh\s*\(/.test(out);
  const hasH =
    /import\s*\{[^}]*\bh\b[^}]*\}\s*from\s*['"][^'"]+['"]/.test(out) ||
    /import\s+h\b\s*[,{]/.test(out) ||
    /import\s+h\s+from\s*['"]/.test(out);
  if (usesH && !hasH) {
    let spec = 'bsig';
    if (opts.runtime) {
      const runtimeAbs = path.resolve(opts.runtime);
      let rel = toPosix(path.relative(path.dirname(cleanId), runtimeAbs));
      if (!rel.startsWith('.')) rel = './' + rel;
      spec = rel;
    }
    out = `import { h } from ${JSON.stringify(spec)};\n` + out;
  }
  return { code: out, map: null };
}

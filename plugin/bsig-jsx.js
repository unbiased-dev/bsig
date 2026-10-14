import { transformAsync } from '@babel/core';
import jsxTransform from '@babel/plugin-transform-react-jsx';
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

export default function bsig(opts = {}) {
  return {
    name: 'vite-plugin-bsig',
    enforce: 'pre',
    async transform(code, id) {
      const cleanId = id.split('?')[0];
      if (!cleanId.endsWith('.jsx')) return null;
      // skip runtime + plugin itself (no JSX there anyway)
      if (cleanId.endsWith('runtime.js') || cleanId.includes('bsig-jsx')) return null;
      if (!code.includes('<')) return null;
      // Auto-import h so JSX files don't need `import { h }`.
      // Only when the file doesn't already bring h into scope.
      const hasHImport =
        /import\s*\{[^}]*\bh\b[^}]*\}\s*from\s*['"][^'"]+['"]/.test(code) ||
        /import\s+h\b\s*[,{]/.test(code) ||
        /import\s+h\s+from\s*['"]/.test(code);
      let input = code;
      if (!hasHImport) {
        // Default: import h from the bsig package itself. This must be a
        // package specifier (not a relative path) so every consumer file —
        // no matter how deeply nested — resolves to the SAME module
        // instance. A relative default once caused a dual-runtime bug where
        // signals updated but the DOM never did.
        let spec = 'bsig';
        if (opts.runtime) {
          const runtimeAbs = path.resolve(opts.runtime);
          let rel = toPosix(path.relative(path.dirname(cleanId), runtimeAbs));
          if (!rel.startsWith('.')) rel = './' + rel;
          spec = rel;
        }
        input = `import { h } from ${JSON.stringify(spec)};\n` + code;
      }
      const result = await transformAsync(input, {
        filename: cleanId,
        presets: [],
        plugins: [
          autoThunkPlugin,
          [jsxTransform, { pragma: 'h', pragmaFrag: 'null' }],
        ],
        ast: false,
        code: true,
        babelrc: false,
        configFile: false,
      });
      return result?.code ? { code: result.code, map: null } : null;
    },
  };
}

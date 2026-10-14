import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// `bsig/router` must be a separate entry: importing the runtime must not drag
// the router (or its `regexparam` dependency) into the bundle. esbuild is the
// bundler here; the same holds for any tree-shaker given `sideEffects: false`.
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));
const esbuild = require('esbuild');

const bundle = (entry) => {
  const tmp = path.join(here, `__router_shake_${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, entry);
  try {
    return esbuild.buildSync({
      entryPoints: [tmp],
      bundle: true,
      format: 'esm',
      write: false,
      logLevel: 'silent',
    }).outputFiles[0].text;
  } finally {
    fs.rmSync(tmp);
  }
};

describe('router tree-shaking', () => {
  it('is excluded when only the runtime is imported', () => {
    const out = bundle(`
      import mount, { signal } from '../runtime.js';
      const s = signal(0);
      mount(document.body, () => s.value);
    `);
    assert.ok(!out.includes('router.depth'), 'router code must be absent');
    assert.ok(!out.includes('regexparam'), 'router dependency must be absent');
  });

  it('is included when bsig/router is imported', () => {
    const out = bundle(`
      import { createRouter, matchTree } from '../router.js';
      console.log(createRouter, matchTree);
    `);
    assert.ok(out.includes('router.depth'), 'router code must be present');
  });
});

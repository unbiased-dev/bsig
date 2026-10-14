import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// `bsig/auth` must be a separate entry: importing the runtime must not drag the
// auth client (or any of its code) into the bundle. esbuild is the bundler here;
// the same holds for any tree-shaker given `sideEffects: false`.
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));
const esbuild = require('esbuild');

// A string unique to auth.js, used as the presence marker.
const MARKER = 'bsig.auth.session';

const bundle = (entry) => {
  const tmp = path.join(here, `__auth_shake_${Math.random().toString(36).slice(2)}.mjs`);
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

describe('auth tree-shaking', () => {
  it('is excluded when only the runtime is imported', () => {
    const out = bundle(`
      import mount, { signal } from '../runtime.js';
      const s = signal(0);
      mount(document.body, () => s.value);
    `);
    assert.ok(!out.includes(MARKER), 'auth code must be absent');
    assert.ok(!out.includes('/sign-in/email'), 'auth endpoints must be absent');
  });

  it('is included when bsig/auth is imported', () => {
    const out = bundle(`
      import { initAuth, session, refreshSession, startSessionRefresh, signInEmail } from '../auth.js';
      console.log(initAuth, session, refreshSession, startSessionRefresh, signInEmail);
    `);
    assert.ok(out.includes(MARKER), 'auth code must be present');
  });
});

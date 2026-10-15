import { describe, it, expect } from 'bun:test';
import { bundle } from './helpers.ts';

// `bsig/auth` must be a separate entry: importing the runtime must not drag the
// auth client (or any of its code) into the bundle. Bun.build is the bundler
// here; the same holds for any tree-shaker given `sideEffects: false`.
const MARKER = 'bsig.auth.session';

describe('auth tree-shaking', () => {
  it('is excluded when only the runtime is imported', async () => {
    const out = await bundle(`
      import mount, { signal } from '../runtime.js';
      const s = signal(0);
      mount(document.body, () => s.value);
    `);
    expect(out).not.toContain(MARKER);
    expect(out).not.toContain('/sign-in/email');
  });

  it('is included when bsig/auth is imported', async () => {
    const out = await bundle(`
      import { initAuth, session, refreshSession, startSessionRefresh, signInEmail } from '../auth.js';
      console.log(initAuth, session, refreshSession, startSessionRefresh, signInEmail);
    `);
    expect(out).toContain(MARKER);
  });
});

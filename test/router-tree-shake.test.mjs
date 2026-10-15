import { describe, it, expect } from 'bun:test';
import { bundle } from './helpers.ts';

// `bsig/router` must be a separate entry: importing the runtime must not drag
// the router (or its `regexparam` dependency) into the bundle. Bun.build is the
// bundler here; the same holds for any tree-shaker given `sideEffects: false`.
describe('router tree-shaking', () => {
  it('is excluded when only the runtime is imported', async () => {
    const out = await bundle(`
      import mount, { signal } from '../runtime.js';
      const s = signal(0);
      mount(document.body, () => s.value);
    `);
    expect(out).not.toContain('router.depth');
    expect(out).not.toContain('regexparam');
  });

  it('is included when bsig/router is imported', async () => {
    const out = await bundle(`
      import { createRouter, matchTree } from '../router.js';
      console.log(createRouter, matchTree);
    `);
    expect(out).toContain('router.depth');
  });
});

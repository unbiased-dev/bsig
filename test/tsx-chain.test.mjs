import { describe, it, expect } from 'bun:test';
import { bundle, flush } from './helpers.ts';

// End-to-end through the real transform chain the bundler uses:
// .tsx source -> bsig plugin (thunks + h + TS strip) -> Bun.build bundle ->
// happy-dom interaction. Proves .tsx output is actually reactive.
const plugin = (await import('../plugin/bsig-jsx.js')).default();

describe('tsx chain reactivity', () => {
  it('counter updates through plugin + bundle', async () => {
    const src = `import mount, { signal } from './runtime.js';
const count: number = signal(0);
function App(): unknown {
  return <div><p>Count: {count.value}</p><button onClick={() => count.value++}>+</button></div>;
}
mount(document.getElementById('t')!, App);
(globalThis as Record<string, unknown>).__go = () => { count.value = 41; };`;
    const out = await plugin.transform(src, `${import.meta.dir}/T.tsx`);
    // sanity: types gone, thunk present, h imported from the package
    expect(out.code).not.toContain(': number');
    expect(out.code).toMatch(/\(\) => count\.value/);
    // rewrite imports to the local runtime for bundling
    const code = await bundle(
      out.code
        .replaceAll('from "bsig"', 'from "../runtime.js"')
        .replaceAll("from './runtime.js'", 'from "../runtime.js"'),
      { loader: 'jsx', format: 'iife' },
    );
    const target = document.createElement('div');
    target.id = 't';
    document.body.appendChild(target);
    (0, eval)(code);
    await flush();
    expect(target.textContent).toMatch(/Count: 0/);
    target.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
    await flush();
    expect(target.textContent).toMatch(/Count: 1/);
    target.remove();
  });
});

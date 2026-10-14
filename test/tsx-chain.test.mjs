import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

// End-to-end through the real transform chain the bundler uses:
// .tsx source -> bsig plugin (thunks + h + TS strip) -> esbuild bundle ->
// jsdom interaction. Proves .tsx output is actually reactive.
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));
const esbuild = require('esbuild');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const plugin = (await import('../plugin/bsig-jsx.js')).default();
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('tsx chain reactivity', () => {
  it('counter updates through plugin + bundle', async () => {
    const src = `import mount, { signal } from './runtime.js';
const count: number = signal(0);
function App(): unknown {
  return <div><p>Count: {count.value}</p><button onClick={() => count.value++}>+</button></div>;
}
mount(document.getElementById('t')!, App);
(globalThis as Record<string, unknown>).__go = () => { count.value = 41; };`;
    const out = await plugin.transform(src, path.join(here, 'T.tsx'));
    // sanity: types gone, thunk present, h imported from the package
    assert.ok(!out.code.includes(': number'));
    assert.match(out.code, /\(\) => count\.value/);
    const tmp = path.join(here, '__tsx_tmp.jsx');
    // rewrite imports to the absolute local runtime for bundling
    fs.writeFileSync(tmp, out.code.replaceAll(`from "bsig"`, `from "../runtime.js"`).replaceAll(`from './runtime.js'`, `from '../runtime.js'`));
    let code;
    try {
      code = esbuild.buildSync({ entryPoints: [tmp], bundle: true, format: 'iife', write: false, logLevel: 'silent' }).outputFiles[0].text;
    } finally {
      fs.rmSync(tmp);
    }
    const target = document.createElement('div');
    target.id = 't';
    document.body.appendChild(target);
    (0, eval)(code);
    await flush();
    assert.match(target.textContent, /Count: 0/);
    target.querySelector('button').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await flush();
    assert.match(target.textContent, /Count: 1/);
    target.remove();
  });
});

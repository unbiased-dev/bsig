import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const plugin = (await import('../plugin/bun.js')).default;

const collect = () => {
  const hooks = [];
  return {
    build: { onLoad: (opts, cb) => hooks.push({ opts, cb }) },
    hooks,
  };
};

const COUNTER = `import mount, { signal } from 'bsig';
const count = signal(0);
function App() {
  return <div><p>Count: {count.value}</p><button onClick={() => count.value++}>+</button></div>;
}
mount(document.getElementById('app')!, App);
`;

describe('bun plugin', () => {
  it('exposes a BunPlugin-shaped object', () => {
    assert.equal(plugin.name, 'bsig');
    assert.equal(typeof plugin.setup, 'function');
  });

  it('thunks .tsx dynamics and injects the h import', async () => {
    const { build, hooks } = collect();
    plugin.setup(build);
    assert.equal(hooks.length, 1);
    assert.ok(hooks[0].opts.filter.test('App.tsx'));
    assert.ok(hooks[0].opts.filter.test('App.jsx'));
    assert.ok(!hooks[0].opts.filter.test('App.ts'));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsig-bun-'));
    const file = path.join(dir, 'App.tsx');
    fs.writeFileSync(file, COUNTER);
    const out = await hooks[0].cb({ path: file });
    assert.equal(out.loader, 'tsx');
    assert.match(out.contents, /\(\) => count\.value/);
    assert.match(out.contents, /import \{ h \} from "bsig"/);
    fs.rmSync(dir, { recursive: true });
  });

  it('passes node_modules and JSX-free files through untouched', async () => {
    const { build, hooks } = collect();
    plugin.setup(build);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsig-bun-'));
    const vendored = path.join(dir, 'node_modules', 'x');
    fs.mkdirSync(vendored, { recursive: true });
    const vfile = path.join(vendored, 'V.tsx');
    fs.writeFileSync(vfile, COUNTER);
    const vout = await hooks[0].cb({ path: vfile });
    assert.equal(vout.contents, COUNTER);
    const plain = path.join(dir, 'P.tsx');
    fs.writeFileSync(plain, 'export const a: number = 1;\n');
    const pout = await hooks[0].cb({ path: plain });
    assert.equal(pout.contents, 'export const a: number = 1;\n');
    fs.rmSync(dir, { recursive: true });
  });

  it('end-to-end: Bun.build + plugin stays reactive after click', async (t) => {
    let hasBun = true;
    try {
      execFileSync('bun', ['--version'], { stdio: 'ignore' });
    } catch {
      hasBun = false;
    }
    if (!hasBun) {
      t.skip('bun binary not available');
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsig-bun-e2e-'));
    try {
      // 'bsig' must resolve from the fixture: symlink the repo as the package.
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.symlinkSync(repo, path.join(dir, 'node_modules', 'bsig'), 'dir');
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          jsx: 'react-jsx',
          jsxImportSource: 'bsig',
          lib: ['ES2022', 'DOM'],
        },
      }));
      fs.writeFileSync(path.join(dir, 'app.tsx'), COUNTER);
      fs.writeFileSync(path.join(dir, 'build.mjs'), `
import plugin from ${JSON.stringify(path.join(repo, 'plugin', 'bun.js'))};
const out = await Bun.build({ entrypoints: ['./app.tsx'], plugins: [plugin] });
if (!out.success) { console.error(out.logs); process.exit(1); }
await Bun.write('./bundle.js', out.outputs[0]);
`);
      execFileSync('bun', ['build.mjs'], { cwd: dir, stdio: 'pipe' });
      const code = fs.readFileSync(path.join(dir, 'bundle.js'), 'utf8');
      assert.match(code, /\(\) => count\.value/);

      const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true });
      globalThis.window = dom.window;
      globalThis.document = dom.window.document;
      globalThis.Node = dom.window.Node;
      globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
      globalThis.MutationObserver = dom.window.MutationObserver;
      (0, eval)(code);
      await new Promise((r) => setTimeout(r, 0));
      const doc = dom.window.document;
      assert.match(doc.getElementById('app').textContent, /Count: 0/);
      doc.querySelector('button').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
      assert.match(doc.getElementById('app').textContent, /Count: 1/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.Node;
      delete globalThis.HTMLUnknownElement;
      delete globalThis.MutationObserver;
    }
  });
});

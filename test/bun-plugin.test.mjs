import { describe, it, expect } from 'bun:test';
import { $ } from 'bun';

const repo = `${import.meta.dir}/..`;
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
    expect(plugin.name).toBe('bsig');
    expect(typeof plugin.setup).toBe('function');
  });

  it('thunks .tsx dynamics and injects the h import', async () => {
    const { build, hooks } = collect();
    plugin.setup(build);
    expect(hooks.length).toBe(1);
    expect(hooks[0].opts.filter.test('App.tsx')).toBe(true);
    expect(hooks[0].opts.filter.test('App.jsx')).toBe(true);
    expect(hooks[0].opts.filter.test('App.ts')).toBe(false);

    const file = `${import.meta.dir}/__bun_plugin_App.tsx`;
    await Bun.write(file, COUNTER);
    try {
      const out = await hooks[0].cb({ path: file });
      expect(out.loader).toBe('tsx');
      expect(out.contents).toMatch(/\(\) => count\.value/);
      expect(out.contents).toMatch(/import \{ h \} from "bsig"/);
    } finally {
      await Bun.file(file).delete();
    }
  });

  it('passes node_modules and JSX-free files through untouched', async () => {
    const { build, hooks } = collect();
    plugin.setup(build);
    const vendored = `${import.meta.dir}/__bun_plugin_nm/node_modules/x/V.tsx`;
    const plain = `${import.meta.dir}/__bun_plugin_plain/P.tsx`;
    await Bun.write(vendored, COUNTER);
    await Bun.write(plain, 'export const a: number = 1;\n');
    try {
      const vout = await hooks[0].cb({ path: vendored });
      expect(vout.contents).toBe(COUNTER);
      const pout = await hooks[0].cb({ path: plain });
      expect(pout.contents).toBe('export const a: number = 1;\n');
    } finally {
      await $`rm -rf ${import.meta.dir}/__bun_plugin_nm ${import.meta.dir}/__bun_plugin_plain`.quiet();
    }
  });

  it('end-to-end: Bun.build + plugin stays reactive after click', async () => {
    const dir = `${import.meta.dir}/__bun_e2e`;
    await $`mkdir -p ${dir}/node_modules`.quiet();
    await $`ln -sfn ${repo} ${dir}/node_modules/bsig`.quiet();
    await Bun.write(
      `${dir}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          jsx: 'react-jsx',
          jsxImportSource: 'bsig',
          lib: ['ES2022', 'DOM'],
        },
      }),
    );
    await Bun.write(`${dir}/app.tsx`, COUNTER);
    try {
      // 'bsig' resolves through the fixture's symlinked node_modules.
      const out = await Bun.build({
        entrypoints: [`${dir}/app.tsx`],
        plugins: [plugin],
        format: 'esm',
      });
      expect(out.success).toBe(true);
      const code = await out.outputs[0].text();
      expect(code).toMatch(/\(\) => count\.value/);

      document.body.innerHTML = '<div id="app"></div>';
      (0, eval)(code);
      await new Promise((r) => setTimeout(r, 0));
      const app = document.getElementById('app');
      expect(app.textContent).toMatch(/Count: 0/);
      app.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
      expect(app.textContent).toMatch(/Count: 1/);
    } finally {
      await $`rm -rf ${dir}`.quiet();
    }
  });
});

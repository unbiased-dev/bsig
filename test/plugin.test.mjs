import { describe, it, expect } from 'bun:test';

const plugin = (await import('../plugin/bsig-jsx.js')).default();
const t = (code, file = '/proj/src/X.jsx') => plugin.transform(code, file).then((r) => r?.code ?? null);

describe('auto-thunk', () => {
  it('wraps signal reads in children', async () => {
    const out = await t(`const a = <p>Hello, {name.value};</p>;`);
    expect(out).toMatch(/\(\) => name\.value/);
  });

  it('wraps ternaries, &&, and map calls', async () => {
    expect(await t(`const a = <p>{show.value ? 'x' : 'y'};</p>;`)).toMatch(/\(\) => show\.value/);
    expect(await t(`const a = <div>{show.value && <span/>};</div>;`)).toMatch(/\(\) => show\.value &&/);
    expect(await t(`const a = <ul>{items.value.map(i => <li>{i}</li>)};</ul>;`)).toMatch(/\(\) => items\.value\.map/);
  });

  it('does not wrap For()/If() calls (stable caches)', async () => {
    const f = await t(`const a = <ul>{For(rows, 'id', r => <li/>)};</ul>;`);
    expect(f).not.toContain('() => For(');
    const i = await t(`const a = <div>{If(() => c, () => <b/>)};</div>;`);
    expect(i).not.toContain('() => If(');
  });

  it('wraps dynamic props, skips events/ref/statics', async () => {
    const out = await t(`const a = <button disabled={d.value} title="hi" count={3} onClick={() => go()} ref={r}>{label.value}</button>;`);
    expect(out).toMatch(/disabled: \(\) => d\.value/);
    expect(out).toMatch(/title: "hi"/);
    expect(out).toMatch(/onClick: \(\) => go\(\)/);
    expect(out).not.toContain('() => r'); // ref untouched
  });

  it('skips already-function expressions', async () => {
    const out = await t(`const a = <p>{() => v.value};</p>;`);
    expect(out).not.toContain('() => () =>');
  });

  it('thunks <Show> element children so each activation rebuilds them', async () => {
    const out = await t(`const a = <Show when={c.value}><b>{x.value}</b></Show>;`);
    expect(out).toMatch(/h\(Show, \{[\s\S]*\}, \(\) => h\("b"/);
    // a nested component child is wrapped too, not just the outer element
    const nested = await t(`const a = <Show when={c.value}><Layout><b/></Layout></Show>;`);
    expect(nested).toMatch(/\(\) => h\(Layout/);
    // expression children are already thunked; do not double-wrap
    const expr = await t(`const a = <Show when={c.value}>{<b/>}</Show>;`);
    expect(expr).not.toContain('() => () =>');
  });
});

describe('package manifest', () => {
  it('exports runtime, plugin, and both JSX runtimes', async () => {
    const pkg = await Bun.file(`${import.meta.dir}/../package.json`).json();
    for (const key of ['.', './plugin', './jsx-runtime', './jsx-dev-runtime', './bun-plugin']) {
      expect(pkg.exports[key]).toBeTruthy(); // `${key}` exported
    }
    // dev + prod JSX runtimes resolve to files that exist in the packlist
    for (const key of ['./jsx-runtime', './jsx-dev-runtime']) {
      const file = pkg.exports[key].import.replace('./', '');
      expect(await Bun.file(`${import.meta.dir}/../${file}`).exists()).toBe(true); // file
      expect(pkg.files.some((f) => file === f || file.startsWith(f.replace(/\/$/, '')))).toBe(true); // `${file}` packed
    }
  });

  it('jsx-dev-runtime exposes jsx/jsxs/Fragment like the prod one', async () => {
    const prod = await import('../jsx-runtime.js');
    expect(Object.keys(prod).sort()).toEqual(['Fragment', 'jsx', 'jsxDEV', 'jsxs']);
    // jsxDEV ignores React's extra dev args (maybeKey, isStaticChildren, source, self)
    const el = prod.jsxDEV('div', { children: 'hi' }, undefined, false, { fileName: 'x' }, undefined);
    expect(el.textContent).toBe('hi');
  });
});

describe('h auto-import', () => {
  it('injects once when missing', async () => {
    const out = await t(`const a = <div/>;`, '/proj/src/A.jsx');
    expect(out.match(/import \{ h \}/g).length).toBe(1);
    expect(out).toMatch(/from "bsig"/);
  });

  it('injects the package spec even for nested files (single instance)', async () => {
    const out = await t(`const a = <div/>;`, '/proj/src/nested/deep/B.jsx');
    expect(out).toMatch(/from "bsig"/);
  });

  it('runtime opt resolves relative to each file', async () => {
    const { default: mk } = await import('../plugin/bsig-jsx.js');
    const out = await mk({ runtime: '/proj/src/runtime.js' }).transform(`const a = <div/>;`, '/proj/src/nested/deep/B.jsx');
    expect(out.code).toMatch(/from "\.\.\/\.\.\/runtime\.js"/);
  });

  it('never duplicates an existing h import', async () => {
    const out = await t(`import { h, signal } from './runtime.js';\nconst a = <div/>;`, '/proj/src/C.jsx');
    expect(out.match(/runtime\.js/g).length).toBe(1);
  });

  it('ignores non-JSX and non-jsx/tsx files', async () => {
    expect(await t(`const a = 1;`, '/proj/src/D.jsx')).toBeNull();
    expect(await t(`const a = <div/>;`, '/proj/src/E.js')).toBeNull();
    expect(await t(`const a = 1;`, '/proj/src/F.tsx')).toBeNull();
  });

  it('transforms .tsx: strips types, wraps dynamics, keeps h import', async () => {
    const plugin = (await import('../plugin/bsig-jsx.js')).default();
    const src = `import { signal } from 'bsig';
const count: number = signal(0);
type P = { t?: string };
export default function A(p: P) {
  return <div class={count.value > 1 ? 'm' : 'f'}><p>{count.value}: {p.t as string}</p></div>;
}`;
    const out = (await plugin.transform(src, '/proj/src/A.tsx')).code;
    expect(out.includes(': number')).toBe(false); // types stripped
    expect(out.includes('as string')).toBe(false);
    expect(out.includes('type P')).toBe(false);
    expect(out).toMatch(/\(\) => count\.value/);
    expect(out).toMatch(/import \{ h \} from "bsig"/);
  });
});

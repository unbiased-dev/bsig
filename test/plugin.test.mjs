import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const plugin = (await import('../plugin/bsig-jsx.js')).default();
const t = (code, file = '/proj/src/X.jsx') => plugin.transform(code, file).then((r) => r?.code ?? null);

describe('auto-thunk', () => {
  it('wraps signal reads in children', async () => {
    const out = await t(`const a = <p>Hello, {name.value};</p>;`);
    assert.match(out, /\(\) => name\.value/);
  });

  it('wraps ternaries, &&, and map calls', async () => {
    assert.match(await t(`const a = <p>{show.value ? 'x' : 'y'};</p>;`), /\(\) => show\.value/);
    assert.match(await t(`const a = <div>{show.value && <span/>};</div>;`), /\(\) => show\.value &&/);
    assert.match(await t(`const a = <ul>{items.value.map(i => <li>{i}</li>)};</ul>;`), /\(\) => items\.value\.map/);
  });

  it('does not wrap For()/If() calls (stable caches)', async () => {
    const f = await t(`const a = <ul>{For(rows, 'id', r => <li/>)};</ul>;`);
    assert.ok(!f.includes('() => For('), f);
    const i = await t(`const a = <div>{If(() => c, () => <b/>)};</div>;`);
    assert.ok(!i.includes('() => If('), i);
  });

  it('wraps dynamic props, skips events/ref/statics', async () => {
    const out = await t(`const a = <button disabled={d.value} title="hi" count={3} onClick={() => go()} ref={r}>{label.value}</button>;`);
    assert.match(out, /disabled: \(\) => d\.value/);
    assert.match(out, /title: "hi"/);
    assert.match(out, /onClick: \(\) => go\(\)/);
    assert.ok(!out.includes('() => r'), 'ref untouched');
  });

  it('skips already-function expressions', async () => {
    const out = await t(`const a = <p>{() => v.value};</p>;`);
    assert.ok(!out.includes('() => () =>'), out);
  });

  it('thunks <Show> element children so each activation rebuilds them', async () => {
    const out = await t(`const a = <Show when={c.value}><b>{x.value}</b></Show>;`);
    assert.match(out, /h\(Show, \{[\s\S]*\}, \(\) => h\("b"/);
    // a nested component child is wrapped too, not just the outer element
    const nested = await t(`const a = <Show when={c.value}><Layout><b/></Layout></Show>;`);
    assert.match(nested, /\(\) => h\(Layout/);
    // expression children are already thunked; do not double-wrap
    const expr = await t(`const a = <Show when={c.value}>{<b/>}</Show>;`);
    assert.ok(!expr.includes('() => () =>'), expr);
  });
});

describe('package manifest', () => {
  it('exports runtime, plugin, and both JSX runtimes', async () => {
    const fs = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    for (const key of ['.', './plugin', './jsx-runtime', './jsx-dev-runtime', './bun-plugin']) {
      assert.ok(pkg.exports[key], `${key} exported`);
    }
    // dev + prod JSX runtimes resolve to files that exist in the packlist
    for (const key of ['./jsx-runtime', './jsx-dev-runtime']) {
      const file = pkg.exports[key].import.replace('./', '');
      assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), file);
      assert.ok(pkg.files.some((f) => file === f || file.startsWith(f.replace(/\/$/, ''))), `${file} packed`);
    }
  });

  it('jsx-dev-runtime exposes jsx/jsxs/Fragment like the prod one', async () => {
    const prod = await import('../jsx-runtime.js');
    assert.deepEqual(Object.keys(prod).sort(), ['Fragment', 'jsx', 'jsxDEV', 'jsxs']);
    // jsxDEV ignores React's extra dev args (maybeKey, isStaticChildren, source, self)
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
    const el = prod.jsxDEV('div', { children: 'hi' }, undefined, false, { fileName: 'x' }, undefined);
    assert.equal(el.textContent, 'hi');
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Node;
    delete globalThis.HTMLUnknownElement;
  });
});

describe('h auto-import', () => {
  it('injects once when missing', async () => {
    const out = await t(`const a = <div/>;`, '/proj/src/A.jsx');
    assert.equal(out.match(/import \{ h \}/g).length, 1);
    assert.match(out, /from "bsig"/);
  });

  it('injects the package spec even for nested files (single instance)', async () => {
    const out = await t(`const a = <div/>;`, '/proj/src/nested/deep/B.jsx');
    assert.match(out, /from "bsig"/);
  });

  it('runtime opt resolves relative to each file', async () => {
    const { default: mk } = await import('../plugin/bsig-jsx.js');
    const out = await mk({ runtime: '/proj/src/runtime.js' }).transform(`const a = <div/>;`, '/proj/src/nested/deep/B.jsx');
    assert.match(out.code, /from "\.\.\/\.\.\/runtime\.js"/);
  });

  it('never duplicates an existing h import', async () => {
    const out = await t(`import { h, signal } from './runtime.js';\nconst a = <div/>;`, '/proj/src/C.jsx');
    assert.equal(out.match(/runtime\.js/g).length, 1);
  });

  it('ignores non-JSX and non-jsx/tsx files', async () => {
    assert.equal(await t(`const a = 1;`, '/proj/src/D.jsx'), null);
    assert.equal(await t(`const a = <div/>;`, '/proj/src/E.js'), null);
    assert.equal(await t(`const a = 1;`, '/proj/src/F.tsx'), null);
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
    assert.ok(!out.includes(': number') && !out.includes('as string') && !out.includes('type P'), 'types stripped');
    assert.match(out, /\(\) => count\.value/);
    assert.match(out, /import \{ h \} from "bsig"/);
  });
});

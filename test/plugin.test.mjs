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

  it('ignores non-JSX and non-jsx files', async () => {
    assert.equal(await t(`const a = 1;`, '/proj/src/D.jsx'), null);
    assert.equal(await t(`const a = <div/>;`, '/proj/src/E.js'), null);
  });
});

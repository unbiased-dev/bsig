import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const { jsx, jsxs, Fragment } = await import('../jsx-runtime.js');
const mount = (await import('../runtime.js')).default;

describe('jsx-runtime (automatic JSX)', () => {
  it('creates elements, children via props', async () => {
    const el = jsx('div', { className: 'a', children: 'hi' });
    assert.equal(el.tagName, 'DIV');
    assert.equal(el.textContent, 'hi');
  });

  it('nests and handles arrays', async () => {
    const el = jsxs('ul', { children: [jsx('li', { children: 'x' }), jsx('li', { children: 'y' })] });
    assert.equal(el.querySelectorAll('li').length, 2);
  });

  it('strips key, keeps ref working', async () => {
    const ref = { value: null };
    const el = jsx('input', { key: 'k1', ref, type: 'text' });
    assert.equal(el.getAttribute('key'), null);
    assert.equal(ref.value, el);
  });

  it('Fragment renders children without wrapper', async () => {
    const target = document.createElement('div');
    mount(target, () => jsx(Fragment, { children: [jsx('p', { children: 'One' }), jsx('p', { children: 'Two' })] }));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(target.textContent, 'OneTwo');
    assert.equal(target.querySelectorAll('p').length, 2);
  });

  it('single (non-array) children work in Show/Transition/elements', async () => {
    const { Show, Transition } = await import('../runtime.js');
    const s = (await import('../runtime.js')).signal(true);
    const target = document.createElement('div');
    // NOTE: jsx() takes children ONLY via config (React parity) — extra
    // positional args are ignored, unlike h().
    target.appendChild(jsx('div', { children: [
      jsx(Show, { when: () => s.value, children: jsx('b', { children: 'solo' }) }),
      jsx(Transition, { enter: ['a', 'b', 'c'], children: jsx('i', { children: 't' }) }),
    ] }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(target.querySelector('b').textContent, 'solo');
    assert.equal(target.querySelector('i').textContent, 't');
  });
});

import { describe, it, expect } from 'bun:test';

const { jsx, jsxs, Fragment } = await import('../jsx-runtime.js');
const mount = (await import('../runtime.js')).default;

describe('jsx-runtime (automatic JSX)', () => {
  it('creates elements, children via props', async () => {
    const el = jsx('div', { className: 'a', children: 'hi' });
    expect(el.tagName).toBe('DIV');
    expect(el.textContent).toBe('hi');
  });

  it('nests and handles arrays', async () => {
    const el = jsxs('ul', { children: [jsx('li', { children: 'x' }), jsx('li', { children: 'y' })] });
    expect(el.querySelectorAll('li').length).toBe(2);
  });

  it('strips key, keeps ref working', async () => {
    const ref = { value: null };
    const el = jsx('input', { key: 'k1', ref, type: 'text' });
    expect(el.getAttribute('key')).toBeNull();
    expect(ref.value).toBe(el);
  });

  it('Fragment renders children without wrapper', async () => {
    const target = document.createElement('div');
    mount(target, () => jsx(Fragment, { children: [jsx('p', { children: 'One' }), jsx('p', { children: 'Two' })] }));
    await new Promise((r) => setTimeout(r, 0));
    expect(target.textContent).toBe('OneTwo');
    expect(target.querySelectorAll('p').length).toBe(2);
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
    expect(target.querySelector('b').textContent).toBe('solo');
    expect(target.querySelector('i').textContent).toBe('t');
  });
});

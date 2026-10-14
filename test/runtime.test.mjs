import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const rt = await import('../runtime.js');
const { h, signal, computed, If, For, Show } = rt;
const mount = rt.default;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('signals', () => {
  it('updates only the bound text without rerendering the element', async () => {
    const count = signal(0);
    const target = document.createElement('div');
    // what the plugin emits for <p>Count: {count.value}</p>
    const el = h('p', null, 'Count: ', () => count.value);
    target.appendChild(el);
    assert.equal(target.textContent, 'Count: 0');
    count.value = 5;
    await flush();
    assert.equal(target.textContent, 'Count: 5');
    assert.equal(target.firstChild, el); // same <p>, no rerender
  });

  it('reactive props stay live', async () => {
    const disabled = signal(false);
    const el = h('button', { disabled: () => disabled.value }, 'x');
    assert.equal(el.disabled, false);
    disabled.value = true;
    await flush();
    assert.equal(el.disabled, true);
  });

  it('computed derives', async () => {
    const c = signal(2);
    const d = computed(() => c.value * 2);
    assert.equal(d.value, 4);
    c.value = 3;
    await flush();
    assert.equal(d.value, 6);
  });
});

describe('components + children', () => {
  it('single-arg component with props.children', async () => {
    const Card = (props) => h('div', { class: 'card' }, props.children);
    const target = document.createElement('div');
    mount(target, Card, { children: [h('span', null, 'hi')] });
    assert.match(target.innerHTML, /hi/);
  });

  it('conditional via plugin-style thunk', async () => {
    const show = signal(false);
    const target = document.createElement('div');
    target.appendChild(h('div', null, () => (show.value ? h('span', null, 'yes') : null)));
    assert.equal(target.textContent, '');
    show.value = true;
    await flush();
    assert.equal(target.textContent, 'yes');
  });

  it('Show component with fallback', async () => {
    const show = signal(false);
    const target = document.createElement('div');
    // Show returns a thunk: must go through h() dynamic path, not appendChild
    target.appendChild(h('div', null, h(Show, { when: () => show.value, fallback: h('i', null, 'out') }, h('b', null, 'in'))));
    await flush();
    assert.equal(target.textContent, 'out');
    show.value = true;
    await flush();
    assert.equal(target.textContent, 'in');
  });

  it('Show accepts plain values and signals, not just thunks', async () => {
    const target = document.createElement('div');
    target.appendChild(h('div', null,
      h(Show, { when: false, fallback: h('i', null, 'fb') }, h('b', null, 'in'))
    ));
    await flush();
    assert.equal(target.textContent, 'fb');
    const s = signal(true);
    const target2 = document.createElement('div');
    target2.appendChild(h('div', null,
      h(Show, { when: s }, h('b', null, 'on'))
    ));
    await flush();
    assert.equal(target2.textContent, 'on');
    s.value = false;
    await flush();
    assert.equal(target2.textContent, '');
  });

  it('For reuses keyed nodes', async () => {
    const todos = signal([{ id: 1, t: 'a' }, { id: 2, t: 'b' }]);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(todos, 'id', (item) => h('li', null, item.t))));
    await flush();
    const first = target.querySelectorAll('li')[0];
    todos.value = [{ id: 2, t: 'b' }, { id: 1, t: 'a' }];
    await flush();
    const after = target.querySelectorAll('li');
    assert.equal(after.length, 2);
    assert.equal(after[1], first); // moved, not recreated
  });

  it('fragment root mounts + unmounts cleanly', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const Root = () => [h('p', null, 'One'), h('p', null, 'Two')];
    // h(null) fragment path returns a thunk, like <>...</>
    const FragRoot = () => h(null, null, h('p', null, 'One'), h('p', null, 'Two'));
    const unmount = mount(target, FragRoot);
    await flush();
    assert.equal(target.textContent, 'OneTwo');
    unmount();
    assert.equal(target.textContent, '');
    target.remove();
  });

  it('If helper stays thunk-only', async () => {
    const on = signal(true);
    const target = document.createElement('div');
    target.appendChild(h('div', null, If(() => on.value, () => h('b', null, 'in'), () => h('i', null, 'out'))));
    await flush();
    assert.equal(target.textContent, 'in');
    on.value = false;
    await flush();
    assert.equal(target.textContent, 'out');
  });
});

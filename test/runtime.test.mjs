import { describe, it, expect } from 'bun:test';

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
    expect(target.textContent).toBe('Count: 0');
    count.value = 5;
    await flush();
    expect(target.textContent).toBe('Count: 5');
    expect(target.firstChild).toBe(el); // same <p>, no rerender
  });

  it('reactive props stay live', async () => {
    const disabled = signal(false);
    const el = h('button', { disabled: () => disabled.value }, 'x');
    expect(el.disabled).toBe(false);
    disabled.value = true;
    await flush();
    expect(el.disabled).toBe(true);
  });

  it('computed derives', async () => {
    const c = signal(2);
    const d = computed(() => c.value * 2);
    expect(d.value).toBe(4);
    c.value = 3;
    await flush();
    expect(d.value).toBe(6);
  });
});

describe('components + children', () => {
  it('single-arg component with props.children', async () => {
    const Card = (props) => h('div', { class: 'card' }, props.children);
    const target = document.createElement('div');
    mount(target, Card, { children: [h('span', null, 'hi')] });
    expect(target.innerHTML).toMatch(/hi/);
  });

  it('conditional via plugin-style thunk', async () => {
    const show = signal(false);
    const target = document.createElement('div');
    target.appendChild(h('div', null, () => (show.value ? h('span', null, 'yes') : null)));
    expect(target.textContent).toBe('');
    show.value = true;
    await flush();
    expect(target.textContent).toBe('yes');
  });

  it('Show component with fallback', async () => {
    const show = signal(false);
    const target = document.createElement('div');
    // Show returns a thunk: must go through h() dynamic path, not appendChild
    target.appendChild(h('div', null, h(Show, { when: () => show.value, fallback: h('i', null, 'out') }, h('b', null, 'in'))));
    await flush();
    expect(target.textContent).toBe('out');
    show.value = true;
    await flush();
    expect(target.textContent).toBe('in');
  });

  it('Show accepts plain values and signals, not just thunks', async () => {
    const target = document.createElement('div');
    target.appendChild(h('div', null,
      h(Show, { when: false, fallback: h('i', null, 'fb') }, h('b', null, 'in'))
    ));
    await flush();
    expect(target.textContent).toBe('fb');
    const s = signal(true);
    const target2 = document.createElement('div');
    target2.appendChild(h('div', null,
      h(Show, { when: s }, h('b', null, 'on'))
    ));
    await flush();
    expect(target2.textContent).toBe('on');
    s.value = false;
    await flush();
    expect(target2.textContent).toBe('');
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
    expect(after.length).toBe(2);
    expect(after[1]).toBe(first); // moved, not recreated
  });

  it('fragment root mounts + unmounts cleanly', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const Root = () => [h('p', null, 'One'), h('p', null, 'Two')];
    // h(null) fragment path returns a thunk, like <>...</>
    const FragRoot = () => h(null, null, h('p', null, 'One'), h('p', null, 'Two'));
    const unmount = mount(target, FragRoot);
    await flush();
    expect(target.textContent).toBe('OneTwo');
    unmount();
    expect(target.textContent).toBe('');
    target.remove();
  });

  it('If helper stays thunk-only', async () => {
    const on = signal(true);
    const target = document.createElement('div');
    target.appendChild(h('div', null, If(() => on.value, () => h('b', null, 'in'), () => h('i', null, 'out'))));
    await flush();
    expect(target.textContent).toBe('in');
    on.value = false;
    await flush();
    expect(target.textContent).toBe('out');
  });
});

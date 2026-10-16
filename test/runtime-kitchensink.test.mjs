// Kitchen-sink coverage for the runtime paths the 2026-10-15 hardening plan
// touches (scheduler, effects/scopes, h/append, components/context,
// reactive, For, If/Show). These tests pass on the pre-fix runtime and must
// keep passing after the fixes: they are the "did we break anything else"
// net. The last describe locks the low-severity edges that the plan
// documents instead of fixing; if one of those starts failing, the
// behavior changed and the docs (skills/bsig/SKILL.md) need an update.
import { describe, it, expect } from 'bun:test';

const rt = await import('../runtime.js');
const { h, signal, computed, reactive, effect, scope, watch, untrack, If, For, Show, Component, Transition, onMount, onUnmount, provide, inject } = rt;
const mount = rt.default;

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('kitchensink: scheduler and effects', () => {
  it('same-value signal set does not re-run effects', async () => {
    const s = signal('a');
    let runs = 0;
    effect(() => { s.value; runs++; });
    await flush();
    s.value = 'a';
    await flush();
    expect(runs).toBe(1);
    s.value = 'b';
    await flush();
    expect(runs).toBe(2);
  });

  it('cascading sets settle within one flush', async () => {
    const a = signal(0), b = signal(0);
    const seen = [];
    effect(() => { const v = a.value; if (v) b.value = v * 2; });
    effect(() => seen.push(b.value));
    await flush();
    a.value = 3;
    await flush();
    expect(seen).toEqual([0, 6]);
  });

  it('effect cleanup runs on re-run and stop, once', async () => {
    const s = signal(0);
    let runs = 0, cleanups = 0;
    const stop = effect(() => {
      runs++;
      s.value;
      return () => cleanups++;
    });
    await flush();
    expect([runs, cleanups]).toEqual([1, 0]);
    s.value = 1;
    await flush();
    expect([runs, cleanups]).toEqual([2, 1]);
    stop();
    expect([runs, cleanups]).toEqual([2, 2]);
    stop();
    expect([runs, cleanups]).toEqual([2, 2]);
  });

  it('untrack returns the callback result and skips reads', async () => {
    const s = signal(1);
    expect(untrack(() => s.value + 1)).toBe(2);
  });

  it('dependents created during a re-run stay owned by the scope', async () => {
    // The creation parent is fixed at effect creation: when a queued re-run
    // (activeEffect null during flush) creates new dependents, they still
    // belong to the enclosing scope and stop with it.
    const s = signal(0), inner = signal(0);
    let childRuns = 0;
    const stop = scope(() => {
      effect(() => {
        if (s.value > 0) effect(() => { inner.value; childRuns++; });
      });
    });
    await flush();
    expect(childRuns).toBe(0);
    s.value = 1;
    await flush();
    expect(childRuns).toBe(1);
    inner.value = 1;
    await flush();
    expect(childRuns).toBe(2);
    stop();
    inner.value = 2;
    await flush();
    expect(childRuns).toBe(2);
  });

  it('watch callback reads are untracked', async () => {
    const src = signal(0), other = signal(0);
    const calls = [];
    watch(src, (n) => { calls.push(n); other.value; });
    await flush();
    other.value = 1;
    await flush();
    expect(calls).toEqual([]);
    src.value = 1;
    await flush();
    expect(calls).toEqual([1]);
  });
});

describe('kitchensink: h props and children', () => {
  it('event props use on* with lowercased event names', () => {
    let clicks = 0;
    const el = h('button', { onClick: () => clicks++ }, 'go');
    el.dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);
  });

  it('props set properties when present, attributes otherwise', () => {
    const el = h('input', { value: 'v', type: 'text', 'data-x': 'y', title: 't' });
    expect(el.value).toBe('v');
    expect(el.type).toBe('text');
    expect(el.getAttribute('data-x')).toBe('y');
    expect(el.title).toBe('t');
  });

  it('dynamic props update property or attribute live', async () => {
    const v = signal('a');
    const el = h('div', { title: () => v.value, 'data-k': () => v.value }, 'x');
    expect(el.title).toBe('a');
    expect(el.getAttribute('data-k')).toBe('a');
    v.value = 'b';
    await flush();
    expect(el.title).toBe('b');
    expect(el.getAttribute('data-k')).toBe('b');
  });

  it('children args win over props.children; props.children alone works', () => {
    expect(h('div', { children: ['ignored'] }, 'used').textContent).toBe('used');
    expect(h('div', { children: 'auto' }).textContent).toBe('auto');
  });

  it('nested array children flatten', () => {
    expect(h('div', null, ['a', ['b', ['c']]]).textContent).toBe('abc');
  });

  it('h(null) is a fragment thunk', () => {
    const frag = h(null, null, 'a', 'b');
    expect(typeof frag).toBe('function');
    expect(frag().join('')).toBe('ab');
  });

  it('onMount runs children first after mount', async () => {
    const order = [];
    const Child = () => {
      onMount(() => order.push('child'));
      return h('i', null, 'c');
    };
    const Parent = () => {
      onMount(() => order.push('parent'));
      return h('div', null, h(Child, null));
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, Parent);
    await flush();
    expect(order).toEqual(['child', 'parent']);
    unmount();
    target.remove();
  });

  it('onUnmount runs parent before children (documented order)', async () => {
    // Plan step-6: mount is children-first; unmount is parent-first.
    const events = [];
    const Child = () => {
      onUnmount(() => events.push('child'));
      return h('i', null, 'c');
    };
    const Parent = () => {
      onUnmount(() => events.push('parent'));
      return h('div', null, h(Child, null));
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, Parent);
    await flush();
    unmount();
    expect(events).toEqual(['parent', 'child']);
    target.remove();
  });

  it('raw appendChild defers mount hooks (characterization)', async () => {
    // Hook flushing is triggered by mount() or a dynamic-region insert. A
    // tree built with h() and attached with raw appendChild keeps its hooks
    // pending; mount() is the supported root path. Locked so a change in
    // this behavior is noticed.
    const events = [];
    const Child = () => {
      onMount(() => events.push('m'));
      return h('i', null, 'c');
    };
    const div = h('div', null, h(Child, null));
    document.body.appendChild(div);
    await flush();
    expect(events).toEqual([]);
    div.remove();
  });
});

describe('kitchensink: dynamic children', () => {
  it('a thunk can swap node types without leaking the old node', async () => {
    const mode = signal(0);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      () => (mode.value === 0 ? h('b', null, 'el') : mode.value === 1 ? 'txt' : h('i', null, 'el2'))));
    await flush();
    expect(target.textContent).toBe('el');
    expect(target.querySelector('b')).toBeTruthy();
    mode.value = 1;
    await flush();
    expect(target.textContent).toBe('txt');
    expect(target.querySelector('b')).toBeNull();
    mode.value = 2;
    await flush();
    expect(target.textContent).toBe('el2');
    expect(target.querySelector('i')).toBeTruthy();
    unmount();
    target.remove();
  });

  it('reordering prebuilt nodes reuses them (LIS path)', async () => {
    const a = h('i', null, 'a');
    const b = h('b', null, 'b');
    const c = h('c', null, 'c');
    const order = signal(0);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      () => (order.value === 0 ? [a, b, c] : [c, a, b])));
    await flush();
    const before = [...target.querySelector('div').childNodes].slice(0, 3); // trailing anchor sentinel stays last
    expect(before.map((n) => n.textContent)).toEqual(['a', 'b', 'c']);
    order.value = 1;
    await flush();
    const after = [...target.querySelector('div').childNodes].slice(0, 3);
    expect(after.map((n) => n.textContent)).toEqual(['c', 'a', 'b']);
    expect(after[0]).toBe(c);
    expect(after[1]).toBe(a);
    expect(after[2]).toBe(b);
    unmount();
    target.remove();
  });

  it('a removed dynamic component stops updating and unmounts', async () => {
    const show = signal(true);
    const s = signal(0);
    let runs = 0, unmounts = 0;
    const Child = () => {
      onUnmount(() => unmounts++);
      return h('p', null, () => { runs++; return String(s.value); });
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      () => (show.value ? h(Child, null) : null)));
    await flush();
    expect(runs).toBe(1);
    show.value = false;
    await flush();
    expect(unmounts).toBe(1);
    const frozen = runs;
    s.value = 1;
    await flush();
    expect(runs).toBe(frozen);
    unmount();
    target.remove();
  });
});

describe('kitchensink: context and Component', () => {
  it('provide/inject is per-subtree and does not leak between siblings', async () => {
    const seen = {};
    const Leaf = (props) => {
      seen[props.name] = inject('k', 'none');
      return h('i', null, props.name);
    };
    const A = () => {
      provide('k', 'a');
      return h('span', null, h(Leaf, { name: 'A' }));
    };
    const B = () => {
      provide('k', 'b');
      return h('span', null, h(Leaf, { name: 'B' }));
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, h(A, null), h(B, null)));
    await flush();
    expect(seen).toEqual({ A: 'a', B: 'b' });
    unmount();
    target.remove();
  });

  it('Component forwards rest props and children to the resolved component', async () => {
    const Wrap = (props) => h('section', { title: props.title }, props.children);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      h(Component, { is: () => Wrap, title: 't' }, h('p', null, 'kid'))));
    await flush();
    const section = target.querySelector('section');
    expect(section.title).toBe('t');
    expect(section.textContent).toBe('kid');
    unmount();
    target.remove();
  });

  it('mount accepts an element root and forwards props', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, 'section', { class: 'root', 'data-r': '1' });
    expect(target.querySelector('section.root').getAttribute('data-r')).toBe('1');
    unmount();
    expect(target.querySelector('section')).toBeNull();
    target.remove();
  });

  it('two mounts in one target unmount independently', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const un1 = mount(target, () => h('p', { class: 'one' }, '1'));
    const un2 = mount(target, () => h('p', { class: 'two' }, '2'));
    expect(target.querySelectorAll('p').length).toBe(2);
    un1();
    expect(target.querySelector('.one')).toBeNull();
    expect(target.querySelector('.two')).toBeTruthy();
    un2();
    expect(target.querySelectorAll('p').length).toBe(0);
    target.remove();
  });
});

describe('kitchensink: reactive', () => {
  it('proxy identity is stable through the cache', () => {
    const obj = { a: 1 };
    const st = reactive(obj);
    expect(reactive(obj)).toBe(st);
    const nested = { n: 1 };
    const wrap = reactive({ nested });
    expect(wrap.nested).toBe(reactive(nested));
    expect(wrap.nested).toBe(wrap.nested);
  });

  it('delete notifies readers and deleting an absent key is a no-op', async () => {
    const st = reactive({ a: 1 });
    let runs = 0;
    effect(() => { st.a; runs++; });
    await flush();
    delete st.a;
    await flush();
    expect(runs).toBe(2);
    expect('a' in st).toBe(false);
    delete st.missing;
    await flush();
    expect(runs).toBe(2);
  });

  it('same-value writes do not notify', async () => {
    const st = reactive({ a: 1 });
    let runs = 0;
    effect(() => { st.a; runs++; });
    await flush();
    st.a = 1;
    await flush();
    expect(runs).toBe(1);
  });

  it('nested writes notify readers of the nested property', async () => {
    const st = reactive({ user: { name: 'Al' } });
    let runs = 0;
    effect(() => { st.user.name; runs++; });
    await flush();
    st.user.name = 'Bo';
    await flush();
    expect(runs).toBe(2);
    expect(st.user.name).toBe('Bo');
  });

  it('array index writes notify only index readers', async () => {
    const arr = reactive(['a', 'b']);
    let idx = 0, len = 0;
    effect(() => { arr[0]; idx++; });
    effect(() => { arr.length; len++; });
    await flush();
    arr[0] = 'z';
    await flush();
    expect(idx).toBe(2);
    expect(len).toBe(1);
  });
});

describe('kitchensink: For', () => {
  it('key function receives item and index', async () => {
    const items = signal([{ id: 'a' }, { id: 'b' }]);
    const calls = [];
    const target = document.createElement('div');
    const list = For(items, (item, index) => { calls.push([item.id, index]); return item.id; }, (item) => h('i', null, item.id));
    target.appendChild(h('ul', null, list));
    await flush();
    expect(calls).toEqual([['a', 0], ['b', 1]]);
    calls.length = 0;
    items.value = [{ id: 'b' }, { id: 'a' }];
    await flush();
    expect(calls).toEqual([['b', 0], ['a', 1]]);
    expect([...target.querySelectorAll('i')].map((i) => i.textContent)).toEqual(['b', 'a']);
  });

  it('unique unkeyed values keep their nodes across updates', async () => {
    const items = signal(['a', 'b', 'c']);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(items, null, (x) => h('li', null, x))));
    await flush();
    const byText = new Map([...target.querySelectorAll('li')].map((li) => [li.textContent, li]));
    items.value = ['b', 'a', 'c'];
    await flush();
    const after = [...target.querySelectorAll('li')];
    expect(after.map((li) => li.textContent)).toEqual(['b', 'a', 'c']);
    expect(after[0]).toBe(byText.get('b'));
    expect(after[1]).toBe(byText.get('a'));
    expect(after[2]).toBe(byText.get('c'));
  });

  it('empty lists render nothing and later additions mount', async () => {
    const items = signal([]);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(items, null, (x) => h('li', null, x))));
    await flush();
    expect(target.querySelectorAll('li').length).toBe(0);
    items.value = ['x'];
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['x']);
  });

  it('accepts a thunk list and a static array', async () => {
    const items = signal([1, 2]);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(() => items.value, null, (x) => h('li', null, String(x)))));
    target.appendChild(h('ol', null, For(['s'], null, (x) => h('li', null, x))));
    await flush();
    expect([...target.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['1', '2']);
    expect([...target.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual(['s']);
    items.value = [3];
    await flush();
    expect([...target.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['3']);
  });

  it('removing a keyed row unmounts its component', async () => {
    const items = signal([{ id: 1 }, { id: 2 }]);
    const events = [];
    const Row = (props) => {
      onUnmount(() => events.push(props.id));
      return h('li', null, String(props.id));
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('ul', null, For(items, 'id', (row) => h(Row, row))));
    await flush();
    expect(events).toEqual([]);
    items.value = [{ id: 1 }];
    await flush();
    expect(events).toEqual([2]);
    unmount();
    expect(events).toEqual([2, 1]);
    target.remove();
  });
});

describe('kitchensink: If and Show', () => {
  it('If uses a static fallback node and does not rebuild it', async () => {
    const cond = signal(false);
    const fallback = h('i', null, 'fb');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, If(() => cond.value, () => h('b', null, 'in'), fallback)));
    await flush();
    expect(target.querySelector('i')).toBe(fallback);
    cond.value = true;
    await flush();
    expect(target.textContent).toBe('in');
    cond.value = false;
    await flush();
    expect(target.querySelector('i')).toBe(fallback);
    unmount();
    target.remove();
  });

  it('Show rebuilds a thunked fallback each activation', async () => {
    const show = signal(false);
    let mounts = 0, unmounts = 0;
    const Fallback = () => {
      onMount(() => mounts++);
      onUnmount(() => unmounts++);
      return h('i', null, 'none');
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      h(Show, { when: () => show.value, fallback: () => h(Fallback, null) }, () => h('b', null, 'yes'))));
    await flush();
    expect(target.textContent).toBe('none');
    expect(mounts).toBe(1);
    show.value = true;
    await flush();
    expect(target.textContent).toBe('yes');
    expect(unmounts).toBe(1);
    show.value = false;
    await flush();
    expect(target.textContent).toBe('none');
    expect(mounts).toBe(2);
    unmount();
    target.remove();
  });

  it('Show supports plain values and signals for when', async () => {
    const s = signal(true);
    const target = document.createElement('div');
    target.appendChild(h('div', null, h(Show, { when: s }, h('b', null, 'on'))));
    await flush();
    expect(target.textContent).toBe('on');
    s.value = false;
    await flush();
    expect(target.textContent).toBe('');
  });
});

// Low-severity edges the plan documents instead of fixing (step-6 Part B).
// These tests characterize the current behavior; a failure here means the
// behavior changed and skills/bsig/SKILL.md needs an update.
describe('kitchensink: documented limitations', () => {
  it('in / Object.keys reads are not tracked', async () => {
    // Plan step-2: reactive has no `has`/`ownKeys` traps; membership reads do
    // not subscribe (documented in skills/bsig/SKILL.md).
    const st = reactive({ a: 1 });
    let runs = 0;
    effect(() => { runs++; 'a' in st; Object.keys(st).length; });
    await flush();
    expect(runs).toBe(1);
    st.a = 2;
    st.b = 3;
    await flush();
    expect(runs).toBe(1); // never re-ran
  });

  it('native collections must not be stored in reactive state', () => {
    const st = reactive({ set: new Set(), date: new Date(0), map: new Map() });
    expect(() => st.set.add(1)).toThrow();
    expect(() => st.date.getTime()).toThrow();
    expect(() => st.map.set('a', 1)).toThrow();
  });

  it('Component is expects a thunk; a raw component renders an empty element', () => {
    const Inner = () => h('p', null, 'raw');
    const target = document.createElement('div');
    expect(() => target.appendChild(h('div', null, h(Component, { is: Inner })))).not.toThrow();
    expect(target.textContent).toBe('');
  });

  it('h mutates its props argument (do not freeze JSX props)', () => {
    const props = {};
    h('div', props, 'x');
    expect(props.children).toEqual(['x']);
    expect(() => h('div', Object.freeze({}), 'x')).toThrow();
  });

  it('a Transition leave without transitionend pins the node', async () => {
    const show = signal(true);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, h(Transition, {
      leave: ['t-all', 'from-b', 'to-a'],
    }, h(Show, { when: () => show.value }, h('div', { class: 'box' }, 'hi')))));
    await flush(60);
    show.value = false;
    await flush(40);
    expect(target.querySelector('.box')).toBeTruthy();
    unmount();
    target.remove();
  });
});

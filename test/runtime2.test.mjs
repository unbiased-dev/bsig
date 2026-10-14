import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const rt = await import('../runtime.js');
const { h, signal, computed, reactive, effect, scope, watch, untrack, If, For, Show, Component, Transition, onMount, onUnmount, provide, inject } = rt;
const mount = rt.default;

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('lifecycle', () => {
  it('mount/unmount ordering with conditional', async () => {
    const events = [];
    const Child = () => {
      const el = h('span', null, 'child');
      onMount(() => events.push(['mount', document.body.contains(el)]));
      onUnmount(() => events.push(['unmount']));
      return el;
    };
    const show = signal(true);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, h(Show, { when: () => show.value }, h(Child, null))));
    await flush();
    assert.deepEqual(events, [['mount', true]]);
    show.value = false;
    await flush();
    assert.deepEqual(events, [['mount', true], ['unmount']]);
    assert.equal(target.textContent, '');
    unmount();
    target.remove();
  });

  it('unmount stops everything, no updates leak', async () => {
    let runs = 0;
    const s = signal(0);
    const App = () => {
      const el = h('p', null, () => (runs++, String(s.value)));
      onUnmount(() => {});
      return el;
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, App);
    await flush();
    const afterMount = runs;
    s.value = 1;
    await flush();
    assert.ok(runs > afterMount);
    const frozen = runs;
    unmount();
    assert.equal(target.textContent, '');
    s.value = 2;
    await flush();
    assert.equal(runs, frozen);
    target.remove();
  });
  it('unmount stops components created inside a dynamic child', async () => {
    // A component instantiated by a dynamic-child thunk used to be orphaned
    // from ancestor cleanup: only scope effects recorded children, and the
    // append boundary is a non-scope effect. Its subscriptions then leaked.
    const events = [];
    let childRuns = 0;
    const s = signal(0);
    const Child = () => {
      const el = h('p', null, () => (childRuns++, String(s.value)));
      onUnmount(() => events.push('child'));
      return el;
    };
    const App = () => h('div', null, () => h(Child, null));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, App);
    await flush();
    assert.deepEqual(events, []);
    const before = childRuns;
    s.value = 1;
    await flush();
    assert.ok(childRuns > before, 'child effect tracked the signal');
    unmount();
    assert.deepEqual(events, ['child']);
    const frozen = childRuns;
    s.value = 2;
    await flush();
    assert.equal(childRuns, frozen, 'no updates leak after unmount');
    target.remove();
  });

  it('an array-returning component keeps its node lifecycle', async () => {
    // Provider-shaped components return an array so the outer `h()` cannot
    // stamp over the child's context; the child's hooks must still run.
    const events = [];
    const Page = () => {
      onMount(() => events.push('mount'));
      onUnmount(() => events.push('unmount'));
      return h('p', null, 'page');
    };
    const Provider = () => [h(Page, null)];
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h(Provider, null));
    await flush();
    assert.deepEqual(events, ['mount']);
    assert.equal(target.textContent, 'page');
    unmount();
    assert.deepEqual(events, ['mount', 'unmount']);
    target.remove();
  });

  it('does not double-run cleanup for an explicitly removed child', async () => {
    const events = [];
    const show = signal(true);
    const Child = () => {
      onUnmount(() => events.push('child'));
      return h('i', null, 'c');
    };
    const App = () => h('div', null, h(Show, { when: () => show.value }, h(Child, null)));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, App);
    await flush();
    show.value = false;
    await flush();
    assert.deepEqual(events, ['child']);
    unmount();
    assert.deepEqual(events, ['child'], 'ancestor unmount must not re-run it');
    target.remove();
  });
});

describe('context', () => {
  it('provide/inject down the tree, default otherwise', async () => {
    const theme = signal('dark');
    const seen = [];
    const Leaf = () => {
      seen.push(inject('theme', 'fallback'));
      return h('i', null, 'leaf');
    };
    const Mid = () => h('div', null, h(Leaf, null));
    const Root = () => {
      provide('theme', theme);
      return h('div', null, h(Mid, null));
    };
    const target = document.createElement('div');
    mount(target, Root);
    await flush();
    assert.equal(seen[0], theme);
    const Outside = () => {
      seen.push(inject('missing', 'dflt'));
      return h('b', null, 'o');
    };
    mount(document.createElement('div'), Outside);
    await flush();
    assert.equal(seen[1], 'dflt');
  });
});

describe('watch/untrack/scope/computed', () => {
  it('watch skips initial run, reports new/old, stops', async () => {
    const s = signal(1);
    const calls = [];
    const stop = watch(s, (n, o) => calls.push([n, o]));
    await flush();
    assert.deepEqual(calls, []);
    s.value = 2;
    await flush();
    assert.deepEqual(calls, [[2, 1]]);
    stop();
    s.value = 3;
    await flush();
    assert.deepEqual(calls, [[2, 1]]);
  });

  it('watch supports getter source', async () => {
    const s = signal('a');
    let got = null;
    watch(() => s.value.toUpperCase(), (n) => (got = n));
    s.value = 'b';
    await flush();
    assert.equal(got, 'B');
  });

  it('untrack reads without subscribing', async () => {
    const a = signal(0), b = signal(0);
    let runs = 0;
    effect(() => { runs++; a.value; untrack(() => b.value); });
    await flush();
    assert.equal(runs, 1);
    b.value = 5;
    await flush();
    assert.equal(runs, 1);
    a.value = 1;
    await flush();
    assert.equal(runs, 2);
  });

  it('scope stops children in cascade', async () => {
    const a = signal(0), b = signal(0);
    let ra = 0, rb = 0;
    const stop = scope(() => {
      effect(() => { a.value; ra++; });
      scope(() => effect(() => { b.value; rb++; }));
    });
    await flush();
    stop();
    a.value = 1;
    b.value = 1;
    await flush();
    assert.equal(ra, 1);
    assert.equal(rb, 1);
  });

  it('computed chains update', async () => {
    const base = signal(2);
    const dbl = computed(() => base.value * 2);
    const quad = computed(() => dbl.value * 2);
    assert.equal(quad.value, 8);
    base.value = 3;
    await flush();
    assert.equal(dbl.value, 6);
    assert.equal(quad.value, 12);
  });

  it('synchronous sets batch into one run', async () => {
    const s = signal(0);
    let runs = 0, last = -1;
    effect(() => { runs++; last = s.value; });
    await flush();
    s.value = 1;
    s.value = 2;
    s.value = 3;
    await flush();
    assert.equal(runs, 2);
    assert.equal(last, 3);
  });
});

describe('reactive', () => {
  it('arrays: push updates length readers', async () => {
    const st = reactive({ items: [] });
    const target = document.createElement('div');
    target.appendChild(h('p', null, () => String(st.items.length)));
    await flush();
    assert.equal(target.textContent, '0');
    st.items.push('x');
    await flush();
    assert.equal(target.textContent, '1');
  });

  it('array methods notify index and length readers', async () => {
    const arr = reactive(['a', 'b', 'c']);
    let li = 0, ll = 0;
    effect(() => { String(arr[1]); li++; });
    effect(() => { String(arr.length); ll++; });
    await flush();
    arr.push('d');
    await flush();
    assert.equal(li, 1, 'push touches no existing index');
    assert.equal(ll, 2, 'push notifies length');
    arr.pop();
    await flush();
    assert.equal(arr.length, 3);
    assert.equal(ll, 3, 'pop notifies length');
    arr.splice(0, 1);
    await flush();
    assert.equal(arr.length, 2);
    assert.equal(ll, 4, 'splice notifies length');
  });

  it('per-property granularity', async () => {
    const st = reactive({ a: 1, b: 2 });
    let ra = 0, rb = 0;
    effect(() => { st.a; ra++; });
    effect(() => { st.b; rb++; });
    await flush();
    st.a = 10;
    await flush();
    assert.equal(ra, 2);
    assert.equal(rb, 1);
  });

  it('nested identity is stable', async () => {
    const st = reactive({ user: { name: 'Al' } });
    assert.equal(st.user, st.user);
    st.user.name = 'Bo';
    await flush();
    assert.equal(st.user.name, 'Bo');
  });
});

describe('ref/svg/Component', () => {
  it('ref via signal and via callback', async () => {
    const s = signal(null);
    let cbEl = null;
    const target = document.createElement('div');
    target.appendChild(h('div', null,
      h('input', { ref: s, type: 'text' }),
      h('input', { ref: (el) => (cbEl = el), type: 'text' })
    ));
    assert.equal(s.value.tagName, 'INPUT');
    assert.equal(cbEl.tagName, 'INPUT');
  });

  it('svg namespace', async () => {
    const el = h('svg', null, h('circle', null));
    assert.equal(el.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(el.firstChild.namespaceURI, 'http://www.w3.org/2000/svg');
  });

  it('Component switches on reactive is, old tree unmounts', async () => {
    const gone = [];
    const A = () => {
      onUnmount(() => gone.push('A'));
      return h('p', null, 'AAA');
    };
    const B = () => h('p', null, 'BBB');
    const which = signal(A);
    const target = document.createElement('div');
    target.appendChild(h('div', null, h(Component, { is: () => which.value })));
    await flush();
    assert.equal(target.textContent, 'AAA');
    which.value = B;
    await flush();
    assert.equal(target.textContent, 'BBB');
    assert.deepEqual(gone, ['A']);
  });
});

describe('list model conformance (seeded fuzz)', () => {
  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it('random ops keep DOM order == data order with node reuse', async () => {
    const rand = mulberry32(42);
    let id = 1;
    const data = signal([]);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(data, 'id', (row) => h('li', null, () => `${row.id}:${row.label}`))));
    const seen = new Map(); // id -> first DOM node
    const snapshot = () => [...target.querySelectorAll('li')].map((li) => li.textContent);
    for (let step = 0; step < 60; step++) {
      const d = data.value.slice();
      const op = rand();
      if (op < 0.3) {
        for (let k = 0; k < 3; k++) d.push(reactive({ id: id++, label: `n${id}` }));
      } else if (op < 0.5 && d.length > 2) {
        const a = Math.floor(rand() * d.length), b = Math.floor(rand() * d.length);
        [d[a], d[b]] = [d[b], d[a]];
      } else if (op < 0.7 && d.length) {
        d.splice(Math.floor(rand() * d.length), 1);
      } else if (op < 0.85 && d.length > 9) {
        for (let i = 0; i < d.length; i += 10) d[i].label += '!';
      } else {
        d.length = 0;
        for (let k = 0; k < Math.floor(rand() * 5); k++) d.push(reactive({ id: id++, label: `r${id}` }));
      }
      data.value = d;
      await flush();
      const expect = d.map((r) => `${r.id}:${r.label}`);
      assert.deepEqual(snapshot(), expect, `step ${step}`);
      for (const li of target.querySelectorAll('li')) {
        const rid = parseInt(li.textContent, 10);
        if (!seen.has(rid)) seen.set(rid, li);
        else assert.equal(seen.get(rid), li, `node reused for id ${rid}`);
      }
    }
  });
  it('adjacent swap moves O(1) nodes, not O(n)', async () => {
    const data = signal([]);
    const init = [];
    for (let i = 1; i <= 15; i++) init.push(reactive({ id: i, label: `x${i}` }));
    data.value = init;
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(data, 'id', (row) => h('li', null, () => `${row.id}`))));
    await flush();
    let moves = 0;
    const proto = dom.window.Node.prototype;
    const orig = proto.insertBefore;
    proto.insertBefore = function (...args) {
      moves++;
      return orig.apply(this, args);
    };
    try {
      const d = data.value.slice();
      [d[11], d[12]] = [d[12], d[11]];
      data.value = d;
      await flush();
    } finally {
      proto.insertBefore = orig;
    }
    assert.deepEqual(
      [...target.querySelectorAll('li')].map((li) => li.textContent),
      data.value.map((r) => String(r.id))
    );
    assert.ok(moves <= 4, `expected ~2 moves, got ${moves}`);
  });
});

describe('Transition', () => {
  it('enter ends in idle, leave waits for transitionend', async () => {
    const show = signal(true);
    const target = document.createElement('div');
    target.appendChild(
      h('div', null, h(Transition, {
        enter: ['t-all', 'from-a', 'to-b'],
        idle: 'idle-c',
        leave: ['t-all', 'from-b', 'to-a'],
      }, h(Show, { when: () => show.value }, h('div', { class: 'box' }, 'hi')))
    ));
    await flush(60);
    let box = target.querySelector('.box');
    assert.ok(box, 'entered node present');
    // jsdom never fires transitionend on its own; enter sits in to-state
    assert.ok(box.classList.contains('to-b'), 'enter progressed, got: ' + box.className);
    box.dispatchEvent(new dom.window.Event('transitionend', { bubbles: true }));
    await flush(10);
    box = target.querySelector('.box');
    assert.ok(box.classList.contains('idle-c'), 'idle class applied, got: ' + box.className);
    assert.ok(!box.classList.contains('from-a') && !box.classList.contains('to-b'), 'transient classes cleaned');
    show.value = false;
    await flush(40);
    box = target.querySelector('.box');
    assert.ok(box, 'leaving node stays until transitionend');
    box.dispatchEvent(new dom.window.Event('transitionend', { bubbles: true }));
    await flush(10);
    assert.equal(target.querySelector('.box'), null, 'removed after transitionend');
  });
});

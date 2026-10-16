import { describe, it, expect } from 'bun:test';

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
    expect(events).toEqual([['mount', true]]);
    show.value = false;
    await flush();
    expect(events).toEqual([['mount', true], ['unmount']]);
    expect(target.textContent).toBe('');
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
    expect(runs).toBeGreaterThan(afterMount);
    const frozen = runs;
    unmount();
    expect(target.textContent).toBe('');
    s.value = 2;
    await flush();
    expect(runs).toBe(frozen);
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
    expect(events).toEqual([]);
    const before = childRuns;
    s.value = 1;
    await flush();
    expect(childRuns).toBeGreaterThan(before); // child effect tracked the signal
    unmount();
    expect(events).toEqual(['child']);
    const frozen = childRuns;
    s.value = 2;
    await flush();
    expect(childRuns).toBe(frozen); // no updates leak after unmount
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
    expect(events).toEqual(['mount']);
    expect(target.textContent).toBe('page');
    unmount();
    expect(events).toEqual(['mount', 'unmount']);
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
    expect(events).toEqual(['child']);
    unmount();
    expect(events).toEqual(['child']); // ancestor unmount must not re-run it
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
    expect(seen[0]).toBe(theme);
    const Outside = () => {
      seen.push(inject('missing', 'dflt'));
      return h('b', null, 'o');
    };
    mount(document.createElement('div'), Outside);
    await flush();
    expect(seen[1]).toBe('dflt');
  });
});

describe('watch/untrack/scope/computed', () => {
  it('watch skips initial run, reports new/old, stops', async () => {
    const s = signal(1);
    const calls = [];
    const stop = watch(s, (n, o) => calls.push([n, o]));
    await flush();
    expect(calls).toEqual([]);
    s.value = 2;
    await flush();
    expect(calls).toEqual([[2, 1]]);
    stop();
    s.value = 3;
    await flush();
    expect(calls).toEqual([[2, 1]]);
  });

  it('watch supports getter source', async () => {
    const s = signal('a');
    let got = null;
    watch(() => s.value.toUpperCase(), (n) => (got = n));
    s.value = 'b';
    await flush();
    expect(got).toBe('B');
  });

  it('untrack reads without subscribing', async () => {
    const a = signal(0), b = signal(0);
    let runs = 0;
    effect(() => { runs++; a.value; untrack(() => b.value); });
    await flush();
    expect(runs).toBe(1);
    b.value = 5;
    await flush();
    expect(runs).toBe(1);
    a.value = 1;
    await flush();
    expect(runs).toBe(2);
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
    expect(ra).toBe(1);
    expect(rb).toBe(1);
  });

  it('computed chains update', async () => {
    const base = signal(2);
    const dbl = computed(() => base.value * 2);
    const quad = computed(() => dbl.value * 2);
    expect(quad.value).toBe(8);
    base.value = 3;
    await flush();
    expect(dbl.value).toBe(6);
    expect(quad.value).toBe(12);
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
    expect(runs).toBe(2);
    expect(last).toBe(3);
  });
});

// B1 (plan step-1): a throwing effect must not brick the scheduler or leave
// the tracker dirty. Each test imports a fresh runtime instance: on the
// pre-fix runtime a throw poisons `isScheduled` for the whole module
// instance, so a shared one would break every later test in the process.
describe('scheduler resilience (B1)', () => {
  it('a throwing effect does not stop later effects', async () => {
    const { signal, effect } = await import('../runtime.js?b1-siblings');
    const s = signal(0);
    const seen = [];
    const errors = [];
    const onError = (e) => errors.push(e.message);
    window.addEventListener('error', onError);
    const originalError = console.error;
    console.error = () => {}; // happy-dom prints errors dispatched from microtasks
    try {
      effect(() => { if (s.value === 1) throw new Error('effect-a-boom'); });
      effect(() => { seen.push(s.value); });
      await flush();
      s.value = 1;
      await flush();
      s.value = 2;
      await flush();
    } finally {
      console.error = originalError;
      window.removeEventListener('error', onError);
    }
    expect(seen).toEqual([0, 1, 2]); // the sibling ran after the throw
    expect(errors.filter((m) => m.includes('effect-a-boom'))).toHaveLength(1); // surfaced, once
  });

  it('work queued after a throwing effect still flushes', async () => {
    const { signal, effect } = await import('../runtime.js?b1-cascade');
    const a = signal(0), b = signal(0);
    const seen = [];
    const errors = [];
    const onError = (e) => errors.push(e.message);
    window.addEventListener('error', onError);
    const originalError = console.error;
    console.error = () => {};
    try {
      effect(() => { if (a.value === 1) throw new Error('cascade-boom'); });
      effect(() => { b.value = a.value; });
      effect(() => seen.push(b.value));
      await flush();
      a.value = 1;
      await flush();
    } finally {
      console.error = originalError;
      window.removeEventListener('error', onError);
    }
    expect(seen).toEqual([0, 1]); // the newly queued effect flushed in the same tick loop
    expect(errors.filter((m) => m.includes('cascade-boom'))).toHaveLength(1);
  });

  it('an initial effect throw does not leave a zombie tracker', async () => {
    const { signal, effect } = await import('../runtime.js?b1-zombie');
    const s = signal(0);
    let boom = 0;
    expect(() => effect(() => { boom++; throw new Error('zombie-boom'); })).toThrow('zombie-boom');
    expect(boom).toBe(1);
    expect(s.value).toBe(0); // top-level read must not subscribe the zombie
    s.value = 1;
    await flush();
    expect(boom).toBe(1); // the failed effect never runs again
  });

  it('untrack restores tracking after a throw', async () => {
    const { signal, effect, untrack } = await import('../runtime.js?b1-untrack');
    const s = signal(0);
    let runs = 0, throws = 0;
    effect(() => {
      runs++;
      try { untrack(() => { throw new Error('untrack-boom'); }); } catch { throws++; }
      s.value; // must still be tracked after the caught throw
    });
    await flush();
    expect(runs).toBe(1);
    s.value = 1;
    await flush();
    expect(runs).toBe(2);
    expect(throws).toBe(2);
  });
});

describe('reactive', () => {
  it('arrays: push updates length readers', async () => {
    const st = reactive({ items: [] });
    const target = document.createElement('div');
    target.appendChild(h('p', null, () => String(st.items.length)));
    await flush();
    expect(target.textContent).toBe('0');
    st.items.push('x');
    await flush();
    expect(target.textContent).toBe('1');
  });

  it('array methods notify index and length readers', async () => {
    const arr = reactive(['a', 'b', 'c']);
    let li = 0, ll = 0;
    effect(() => { String(arr[1]); li++; });
    effect(() => { String(arr.length); ll++; });
    await flush();
    arr.push('d');
    await flush();
    expect(li).toBe(1); // push touches no existing index
    expect(ll).toBe(2); // push notifies length
    arr.pop();
    await flush();
    expect(arr.length).toBe(3);
    expect(ll).toBe(3); // pop notifies length
    arr.splice(0, 1);
    await flush();
    expect(arr.length).toBe(2);
    expect(ll).toBe(4); // splice notifies length
  });

  it('per-property granularity', async () => {
    const st = reactive({ a: 1, b: 2 });
    let ra = 0, rb = 0;
    effect(() => { st.a; ra++; });
    effect(() => { st.b; rb++; });
    await flush();
    st.a = 10;
    await flush();
    expect(ra).toBe(2);
    expect(rb).toBe(1);
  });

  it('nested identity is stable', async () => {
    const st = reactive({ user: { name: 'Al' } });
    expect(st.user).toBe(st.user);
    st.user.name = 'Bo';
    await flush();
    expect(st.user.name).toBe('Bo');
  });

  it('Object.prototype key names are ordinary keys', async () => {
    // Fresh instance: on the pre-fix runtime the read throws while the effect
    // is being created, leaving the shared tracker dirty and poisoning every
    // later test in the process.
    const { reactive, effect } = await import('../runtime.js?b2-proto-keys');
    const st = reactive({ toString: 'orig', constructor: 'c', hasOwnProperty: 'h', valueOf: 'v' });
    const seen = {};
    let runs = 0;
    effect(() => {
      runs++;
      seen.s = st.toString;
      seen.c = st.constructor;
      seen.h = st.hasOwnProperty;
      seen.v = st.valueOf;
    });
    await flush();
    expect(seen).toEqual({ s: 'orig', c: 'c', h: 'h', v: 'v' });
    expect(runs).toBe(1);
    st.toString = 'changed';
    st.valueOf = 'changed-v';
    await flush();
    expect(runs).toBe(2);
    expect(st.toString).toBe('changed');
    expect(st.valueOf).toBe('changed-v');
  });

  it('__proto__ writes do not crash the proxy', async () => {
    const { reactive, effect } = await import('../runtime.js?b2-proto-write');
    const st = reactive({ a: 1 });
    let runs = 0;
    effect(() => { st.a; runs++; });
    await flush();
    expect(() => { st.__proto__ = { evil: 1 }; }).not.toThrow();
    // Raw-JS semantics: the assignment replaced the target's prototype and
    // the proxy keeps working (documented in skills/bsig/SKILL.md).
    expect('evil' in st).toBe(true);
    st.a = 2;
    await flush();
    expect(runs).toBe(2);
    expect(st.a).toBe(2);
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
    expect(s.value.tagName).toBe('INPUT');
    expect(cbEl.tagName).toBe('INPUT');
  });

  it('svg namespace', async () => {
    const el = h('svg', null, h('circle', null));
    expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(el.firstChild.namespaceURI).toBe('http://www.w3.org/2000/svg');
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
    expect(target.textContent).toBe('AAA');
    which.value = B;
    await flush();
    expect(target.textContent).toBe('BBB');
    expect(gone).toEqual(['A']);
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
      const expected = d.map((r) => `${r.id}:${r.label}`);
      expect(snapshot()).toEqual(expected); // step ${step}
      for (const li of target.querySelectorAll('li')) {
        const rid = parseInt(li.textContent, 10);
        if (!seen.has(rid)) seen.set(rid, li);
        else expect(seen.get(rid)).toBe(li); // node reused for id ${rid}
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
    const proto = Node.prototype;
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
    expect(
      [...target.querySelectorAll('li')].map((li) => li.textContent)
    ).toEqual(data.value.map((r) => String(r.id)));
    expect(moves).toBeLessThanOrEqual(4); // expected ~2 moves
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
    expect(box).toBeTruthy(); // entered node present
    // happy-dom never fires transitionend on its own; enter sits in to-state
    expect(box.classList.contains('to-b')).toBe(true); // enter progressed
    box.dispatchEvent(new Event('transitionend', { bubbles: true }));
    await flush(10);
    box = target.querySelector('.box');
    expect(box.classList.contains('idle-c')).toBe(true); // idle class applied
    expect(box.classList.contains('from-a')).toBe(false); // transient classes cleaned
    expect(box.classList.contains('to-b')).toBe(false);
    show.value = false;
    await flush(40);
    box = target.querySelector('.box');
    expect(box).toBeTruthy(); // leaving node stays until transitionend
    box.dispatchEvent(new Event('transitionend', { bubbles: true }));
    await flush(10);
    expect(target.querySelector('.box')).toBeNull(); // removed after transitionend
  });
});

describe('append (dynamic child resolution)', () => {
  it('resolves a thunk nested below a returned array (fragment/outlet depth)', async () => {
    // Mirrors a fragment layout root: the dynamic child yields an array whose
    // outlet thunk returns an array holding the page thunk. The old single
    // unwrap pass stringified the innermost thunk instead of resolving it.
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(
      target,
      () => () => ['x', () => [() => h('p', null, 'deep')]],
    );
    await flush();
    expect(target.textContent).toBe('xdeep');
    expect(target.querySelector('p')).toBeTruthy(); // innermost thunk resolved to a node
    unmount();
    target.remove();
  });

  it('stops a dynamic child held in a component-returned array on unmount', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const label = signal('a');
    // A provider-shaped component returns an array; one slot is a live child.
    const unmount = mount(target, () => [() => h('p', null, () => `v${label.value}`)]);
    await flush();
    const p = target.querySelector('p');
    expect(p.textContent).toBe('va');

    unmount();
    expect(p.isConnected).toBe(false);
    label.value = 'b';
    await flush();
    expect(p.textContent).toBe('va'); // the array's cleanup stopped the live child
    target.remove();
  });
});

// B3 (plan step-3): every activation rebuilds the branch — thunked children
// build fresh nodes, and retained prebuilt component nodes are rebuilt by the
// runtime on re-insert — so bindings stay live and onMount refires.
describe('Show/If branch lifecycle (B3)', () => {
  it('Show rebuilds thunked children across hide/show', async () => {
    const show = signal(true);
    const n = signal(0);
    let mounts = 0, unmounts = 0, runs = 0;
    const Child = () => {
      onMount(() => mounts++);
      onUnmount(() => unmounts++);
      return h('p', null, () => { runs++; return `n=${n.value}`; });
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, h(Show, { when: () => show.value }, () => h(Child, null))));
    await flush();
    expect(target.textContent).toBe('n=0');
    show.value = false;
    await flush();
    expect(target.textContent).toBe('');
    expect([mounts, unmounts]).toEqual([1, 1]);
    show.value = true;
    await flush();
    expect(target.textContent).toBe('n=0');
    expect(mounts).toBe(2); // rebuilt, not revived
    n.value = 1;
    await flush();
    expect(target.textContent).toBe('n=1'); // the rebuilt branch is live
    unmount();
    target.remove();
  });

  it('If factories stay live across switches', async () => {
    const cond = signal(true);
    const n = signal(0);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, If(() => cond.value, () => h('p', null, () => `n=${n.value}`))));
    await flush();
    expect(target.textContent).toBe('n=0');
    cond.value = false;
    await flush();
    expect(target.textContent).toBe('');
    cond.value = true;
    await flush();
    expect(target.textContent).toBe('n=0');
    n.value = 1;
    await flush();
    expect(target.textContent).toBe('n=1');
    unmount();
    target.remove();
  });

  it('prebuilt Show branches revive on re-show', async () => {
    // Decision (2026-10-15, see plans/step-3.md): a re-shown branch is
    // revived — the stopped component is rebuilt (fresh node) so onMount
    // refires and its bindings stay live.
    const show = signal(true);
    const n = signal(0);
    let mounts = 0, unmounts = 0;
    const Child = () => {
      onMount(() => mounts++);
      onUnmount(() => unmounts++);
      return h('p', null, () => `n=${n.value}`);
    };
    const prebuilt = h(Child, null);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, h(Show, { when: () => show.value }, prebuilt)));
    await flush();
    expect(target.textContent).toBe('n=0');
    show.value = false;
    await flush();
    expect(target.textContent).toBe('');
    expect([mounts, unmounts]).toEqual([1, 1]);
    show.value = true;
    await flush();
    expect(target.textContent).toBe('n=0');
    expect([mounts, unmounts]).toEqual([2, 1]); // stopped on hide, rebuilt on re-show
    n.value = 1;
    await flush();
    expect(target.textContent).toBe('n=1'); // the rebuilt branch is live
    unmount();
    expect([mounts, unmounts]).toEqual([2, 2]);
    target.remove();
  });

  it('retained prebuilt nodes revive in user thunks', async () => {
    // The rebuild generalizes beyond Show/If: any dynamic child that returns
    // a stored, already-removed component node gets a fresh live subtree.
    const show = signal(true);
    const n = signal(0);
    let mounts = 0, unmounts = 0;
    const Child = () => {
      onMount(() => mounts++);
      onUnmount(() => unmounts++);
      return h('p', null, () => `n=${n.value}`);
    };
    const prebuilt = h(Child, null);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null, () => (show.value ? [prebuilt] : [])));
    await flush();
    expect(target.textContent).toBe('n=0');
    show.value = false;
    await flush();
    expect(target.textContent).toBe('');
    expect([mounts, unmounts]).toEqual([1, 1]);
    show.value = true;
    await flush();
    expect([mounts, unmounts]).toEqual([2, 1]); // rebuilt, not refired dead
    n.value = 1;
    await flush();
    expect(target.textContent).toBe('n=1');
    unmount();
    expect([mounts, unmounts]).toEqual([2, 2]);
    target.remove();
  });

  it('a dead retained node passed as a child to a new component revives', async () => {
    // Locks the direct-insert path (append): a stopped prebuilt reference
    // handed to a freshly built wrapper must rebuild, not insert dead.
    let mounts = 0, unmounts = 0;
    const n = signal(0);
    const Child = () => {
      onMount(() => mounts++);
      onUnmount(() => unmounts++);
      return h('p', null, () => `n=${n.value}`);
    };
    const prebuilt = h(Child, null);
    const show = signal(true);
    const first = document.createElement('div');
    document.body.appendChild(first);
    const unmount = mount(first, () => h('div', null, () => (show.value ? [prebuilt] : [])));
    await flush();
    show.value = false;
    await flush();
    expect([mounts, unmounts]).toEqual([1, 1]); // removed -> stopped
    const Wrap = (props) => h('section', null, props.children);
    const second = document.createElement('div');
    document.body.appendChild(second);
    const unmount2 = mount(second, () => h(Wrap, null, prebuilt));
    await flush();
    expect([mounts, unmounts]).toEqual([2, 1]); // rebuilt on insert
    n.value = 1;
    await flush();
    expect(second.textContent).toBe('n=1'); // live bindings
    unmount2();
    expect([mounts, unmounts]).toEqual([2, 2]);
    unmount();
    first.remove();
    second.remove();
  });
});

// B4 (plan step-4): switching an If must stop the outgoing branch scope.
// Array-returning branches (Show always returns one) leak today: removal is
// per node and only `node.$s` is stopped, never the array's branch stop.
describe('branch cleanup (B4)', () => {
  it('removed If branches stop updating (array return)', async () => {
    const cond = signal(true);
    const tick = signal(0);
    let runs = 0;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      If(() => cond.value, () => [h('b', null, () => { runs++; return `r${tick.value}`; })])));
    await flush();
    expect(runs).toBe(1);
    cond.value = false;
    await flush();
    expect(target.textContent).toBe('');
    const frozen = runs;
    tick.value = 1;
    await flush();
    expect(runs).toBe(frozen); // no updates from the detached branch
    unmount();
    target.remove();
  });

  it('Show fallback arrays stop updating after switching away', async () => {
    const show = signal(false);
    const tick = signal(0);
    let runs = 0;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      h(Show, {
        when: () => show.value,
        fallback: () => [h('i', null, () => { runs++; return `f${tick.value}`; })],
      }, () => h('b', null, 'in'))));
    await flush();
    expect(target.textContent).toBe('f0');
    expect(runs).toBe(1);
    show.value = true;
    await flush();
    expect(target.textContent).toBe('in');
    const frozen = runs;
    tick.value = 1;
    await flush();
    expect(runs).toBe(frozen); // the outgoing fallback scope was stopped
    unmount();
    target.remove();
  });

  it('plugin-thunked Show children are released by the region unmount (documented residual)', async () => {
    // Effects created while resolving thunked Show children belong to the
    // dynamic region scope, not the branch scope, so they survive toggles
    // until the enclosing region unmounts. Plan step-4 documents this
    // residual; the exact count is locked so a behavior change is noticed.
    const show = signal(true);
    const s = signal(0);
    let runs = 0;
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mount(target, () => h('div', null,
      h(Show, { when: () => show.value }, () => h('p', null, () => { runs++; return `v${s.value}`; }))));
    await flush();
    expect(runs).toBe(1);
    for (let i = 0; i < 3; i++) {
      show.value = false;
      await flush();
      show.value = true;
      await flush();
    }
    expect(runs).toBe(4); // one render per activation
    const before = runs;
    s.value = 1;
    await flush();
    expect(runs).toBe(before + 4); // one effect leaked per activation
    unmount();
    s.value = 2;
    await flush();
    expect(runs).toBe(before + 4); // released with the region
    target.remove();
  });
});

// B5 (plan step-5): unkeyed lists key by item identity, so duplicate values
// share a cache entry and collapse on the next update; duplicate results from
// a key function collapse the same way.
describe('For duplicate keys (B5)', () => {
  it('duplicate values without a key render and stay correct', async () => {
    const items = signal(['a', 'b']);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(items, null, (x) => h('li', null, x))));
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    items.value = ['a', 'a'];
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'a']);
    items.value = ['a'];
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a']);
    items.value = [];
    await flush();
    expect(target.querySelectorAll('li').length).toBe(0);
  });

  it('unkeyed lists starting with duplicates render all rows', async () => {
    const items = signal(['a', 'a']);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(items, null, (x) => h('li', null, x))));
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'a']);
    items.value = ['a', 'a'];
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['a', 'a']);
  });

  it('duplicate key-function results do not drop rows', async () => {
    const items = signal([{ id: 1, t: 'x' }, { id: 1, t: 'y' }]);
    const target = document.createElement('div');
    target.appendChild(h('ul', null, For(items, (r) => r.id, (r) => h('li', null, r.t))));
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['x', 'y']);
    items.value = [{ id: 1, t: 'x' }, { id: 1, t: 'y' }];
    await flush();
    expect([...target.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['x', 'y']);
  });
});

// B6 (plan step-6): boolean children. `false` is skipped; `true` currently
// stringifies to "true". Only the `true` fix changes observable behavior.
describe('boolean children (B6)', () => {
  it('boolean true children render nothing (like false)', () => {
    const el = h('div', null, true, 'x', false, null, undefined);
    expect(el.textContent).toBe('x');
  });

  it('dynamic true and false both render nothing', async () => {
    const flag = signal(true);
    const target = document.createElement('div');
    target.appendChild(h('div', null, () => flag.value));
    expect(target.textContent).toBe('');
    flag.value = false;
    await flush();
    expect(target.textContent).toBe('');
  });

  it('props.children booleans are skipped', () => {
    const el = h('div', { children: [true, 'x', false] });
    expect(el.textContent).toBe('x');
  });

  it('zero and empty string still render', () => {
    expect(h('div', null, 0).textContent).toBe('0');
    expect(h('div', null, '').textContent).toBe('');
    expect(h('div', { children: [0, ''] }).textContent).toBe('0');
  });
});

/* bsig runtime — trimmed Sigwork fork.
 * Fine-grained, no VDOM. Compiler (plugin/bsig-jsx.js) auto-wraps
 * dynamic JSX children/props into () => ..., so components run once
 * and only dependent anchors update.
 */

const isFn = (v) => typeof v === 'function';
const isNode = (v) => v instanceof Node;
// Classic JSX delivers children as arg arrays; the automatic runtime puts a
// lone child unwrapped in props.children. Normalize without splitting strings.
const kidArray = (v) => (Array.isArray(v) ? v.flat(Infinity) : v == null ? [] : [v]);

/*----- Schedule -----*/
let isScheduled = false;
const queue = new Set();
const tick = () => {
  while (queue.size) {
    const runs = [...queue];
    queue.clear();
    runs.forEach((fn) => fn());
  }
  isScheduled = false;
};

/*----- Effects -----*/
let activeEffect = null;
export const effect = (fn, is_scope = false) => {
  let cleanup = null;
  let stopped = false;
  // Drop this run's subscriptions and children. Used both before a re-run
  // (keeping the effect registered with its scope) and on final stop.
  const teardown = () => {
    run.e.forEach((subs) => subs.delete(run));
    run.e.clear();
    isFn(cleanup) && cleanup();
    if (run.k) {
      run.k.slice().forEach((f) => f());
      run.k.length = 0;
    }
  };
  const run = () => {
    // A queued re-run can fire after an explicit stop; don't revive the effect.
    if (stopped) return;
    teardown();
    const prev = activeEffect;
    activeEffect = run;
    cleanup = fn();
    activeEffect = prev;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    teardown();
    // Drop ourselves from the owner's list so a long-lived scope does not
    // retain stops for nodes that were explicitly removed (e.g. a page
    // swapped out on every navigation).
    if (run.o) {
      const i = run.o.indexOf(stop);
      if (i !== -1) run.o.splice(i, 1);
      run.o = null;
    }
  };
  run.e = new Set();
  is_scope && (run.c = []);
  // The creation parent is fixed: dependents created during a *re-run* still
  // belong to the same scope (the enclosing effect may be null while the
  // scheduler flushes a queued re-run).
  run.p = activeEffect;
  run();
  // Register this effect's cleanup with the nearest enclosing *scope*. Scopes
  // don't track reads (see `track`), so a component created inside a
  // dynamic-child boundary — whose parent effect is a non-scope — would
  // otherwise be orphaned when an ancestor unmounts. Walking up to the scope
  // keeps those subtrees in the cleanup cascade. `stop` is idempotent so an
  // explicitly removed node is not torn down twice.
  let owner = run.p;
  while (owner && !owner.c) owner = owner.p;
  if (owner) {
    (owner.k ??= []).push(stop);
    run.o = owner.k;
  }
  return stop;
};
export const scope = (f) => effect(f, true);

const track = (subs) => {
  if (activeEffect && !activeEffect.c) {
    subs.add(activeEffect);
    activeEffect.e.add(subs);
  }
};

/*----- Signals -----*/
export const signal = (value) => {
  const subs = new Set();
  return {
    get value() {
      track(subs);
      return value;
    },
    set value(newValue) {
      if (newValue === value) return;
      value = newValue;
      subs.forEach((fn) => queue.add(fn));
      if (!isScheduled) queueMicrotask(tick);
      isScheduled = true;
    },
  };
};

export const untrack = (fn) => {
  const prev = activeEffect;
  activeEffect = null;
  const result = fn();
  activeEffect = prev;
  return result;
};

export const computed = (fn) => {
  const sig = signal();
  effect(() => (sig.value = fn()));
  return { get value() { return sig.value; } };
};

const notify = (subs, key) => {
  if (subs[key]) {
    subs[key].forEach((fn) => queue.add(fn));
    if (!isScheduled) queueMicrotask(tick);
    isScheduled = true;
  }
};

const reactiveCache = new WeakMap();
export const reactive = (obj) => {
  if (reactiveCache.has(obj)) return reactiveCache.get(obj);
  const subs = {};
  const proxy = new Proxy(obj, {
    get(t, key) {
      track((subs[key] ??= new Set()));
      const val = t[key];
      return val && typeof val === 'object' ? reactive(val) : val;
    },
    set(t, key, val) {
      if (t[key] === val) return true;
      // Real arrays auto-update length on index writes, which would make
      // the later explicit length set look like a no-op and starve length
      // readers (e.g. push/splice). Detect side-effect length changes.
      const oldLen = Array.isArray(t) ? t.length : -1;
      t[key] = val;
      notify(subs, key);
      if (oldLen >= 0 && t.length !== oldLen) notify(subs, 'length');
      return true;
    },
    deleteProperty(t, key) {
      if (!(key in t)) return true;
      const oldLen = Array.isArray(t) ? t.length : -1;
      delete t[key];
      notify(subs, key);
      if (oldLen >= 0 && t.length !== oldLen) notify(subs, 'length');
      return true;
    },
  });
  reactiveCache.set(obj, proxy);
  return proxy;
};

export const watch = (source, cb) => {
  let first = true, oldValue;
  return effect(() => {
    const newValue = isFn(source) ? source() : source.value;
    if (!first) untrack(() => cb(newValue, oldValue));
    else first = false;
    oldValue = newValue;
  });
};

/*----- Components -----*/
let context = null;
// Number of component contexts with unfired onMount hooks. Lets inserts
// skip the mount-hook walk when there is nothing pending (common case:
// plain elements with no components inside).
let pendingHooks = 0;
export const onMount = (fn) => context?.m.push(fn);
export const onUnmount = (fn) => context?.u.push(fn);
export const provide = (key, value) => context && (context.p[key] = value);
export const inject = (key, dft) => context && (key in context.p ? context.p[key] : dft);

export const h = (tag, props, ...children) => {
  props = props || {};
  children = children.flat(Infinity);
  if (props.children === undefined) props.children = children;

  if (isFn(tag)) {
    const prev = context;
    context = { m: [], u: [], p: { ...(prev?.p || {}) } };
    // Capture this component's own context: cleanup must run *its* onUnmount
    // hooks even when the return value is an array (a provider-shaped
    // component) and nothing gets stamped with `$c`.
    const ctx = context;
    let el;
    // Single-arg components: tag(props). No legacy (props, {children, emit}).
    // Child calls parent callbacks directly via props.onX.
    const stop = effect(() => {
      el = tag(props);
      return () => ctx.u.forEach((fn) => fn());
    }, true);
    if (isNode(el) || isFn(el)) {
      el.$c = ctx;
      el.$s = stop;
      if (!ctx.q) {
        ctx.q = true;
        pendingHooks++;
      }
    } else if (Array.isArray(el)) {
      // Array returns (provider components that can't let the outer `h()`
      // stamp their child node) still need a reachable stop function.
      el.$s = stop;
    }
    context = prev;
    return el;
  }

  if (!tag) return () => (children.length ? children : (props.children ?? []));

  let el = document.createElement(tag), is_svg;
  if (el instanceof HTMLUnknownElement) {
    is_svg = el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  for (const key in props) {
    if (key === 'children') continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), props[key]);
    else if (key === 'ref') isFn(props[key]) ? props[key](el) : (props[key].value = el);
    else if (isFn(props[key]))
      effect(() => (key in el && !is_svg ? (el[key] = props[key]()) : el.setAttribute(key, props[key]())));
    else key in el && !is_svg ? (el[key] = props[key]) : el.setAttribute(key, props[key]);
  }

  // Classic JSX passes children as args; the automatic runtime puts them in
  // props.children. Render exactly one source, never both.
  (children.length ? children : [props.children].flat(Infinity)).forEach((child) => append(el, child));
  return el;
};

// Fires pending onMount hooks, children first. Inserts into a detached
// tree (initial construction) leave hooks pending for mount() to flush,
// so onMount always observes an attached node.
const fireMounts = (node, force) => {
  if (!force && pendingHooks === 0) return;
  node.childNodes?.forEach((c) => fireMounts(c, force));
  const c = node.$c;
  if (c && !c.f && (force || node.isConnected)) {
    c.f = true;
    pendingHooks--;
    c.m.forEach((fn) => fn());
  }
};

const append = (parent, child) => {
  if (child === null || child === undefined || child === false) return null;
  if (Array.isArray(child)) {
    // A component may return an array (e.g. a provider that must not be
    // stamped by the outer `h()`); treat it as a list of children.
    const stops = [];
    child.forEach((c) => {
      const s = append(parent, c);
      if (s) stops.push(s);
    });
    return stops.length ? () => stops.forEach((s) => s()) : null;
  }
  if (isFn(child)) {
    const anchor = document.createTextNode('');
    parent.appendChild(anchor);
    let nodes = [];
    const outer = effect(() => {
      effect(() => {
        const newNodes = [child()]
          .flat(Infinity)
          .map((node) => (isFn(node) ? node() : node))
          .flat(Infinity)
          .filter((node) => node !== null && node !== undefined && node !== false)
          .map((node) => (isNode(node) ? node : document.createTextNode(String(node))));
        // Drop vanished nodes (stops scopes, honors leave transitions).
        const kept = new Set(newNodes);
        nodes.forEach((n) => {
          if (!kept.has(n)) remove(n);
        });
        // Keyed reconciliation via LIS: old positions of the new nodes,
        // longest increasing run stays, everything else is placed with one
        // backward pass. A plain nextSibling walk cascades (a single
        // mid-list swap explodes into O(n) moves); LIS moves only what must.
        const oldPos = new Map();
        nodes.forEach((n, i) => {
          if (kept.has(n)) oldPos.set(n, i);
        });
        const sources = newNodes.map((n) => (oldPos.has(n) ? oldPos.get(n) : -1));
        const piles = [];
        const prev = new Array(newNodes.length).fill(-1);
        for (let i = 0; i < sources.length; i++) {
          if (sources[i] === -1) continue;
          let lo = 0, hi = piles.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sources[piles[mid]] < sources[i]) lo = mid + 1;
            else hi = mid;
          }
          if (lo > 0) prev[i] = piles[lo - 1];
          piles[lo] = i;
        }
        const lis = new Set();
        for (let k = piles.length ? piles[piles.length - 1] : -1; k !== -1; k = prev[k]) lis.add(k);
        for (let i = newNodes.length - 1; i >= 0; i--) {
          const node = newNodes[i];
          const ref = newNodes[i + 1] || anchor;
          if (sources[i] === -1) {
            parent.insertBefore(node, ref);
            fireMounts(node);
          } else if (!lis.has(i) && node.nextSibling !== ref) {
            parent.insertBefore(node, ref);
          }
        }
        nodes = newNodes;
      });
    }, true);
    return outer;
  } else if (isNode(child)) parent.appendChild(child);
  else parent.appendChild(document.createTextNode(String(child)));
  return null;
};

const remove = (node, countable = true) => {
  node.$s?.();
  // Unfiring allows reinsertion to remount; re-count so the hook walk
  // is not pruned while a pending hook exists. Terminal unmounts pass
  // countable=false since those trees can never remount.
  if (countable && node.$c && node.$c.f) {
    node.$c.f = false;
    pendingHooks++;
  }
  node.$l?.(() => node.remove());
  if (!node.$l) node.remove();
};

const render = (fn, ...data) => {
  let node;
  const stop = effect(() => {
    node = fn(...data);
    if (isFn(node)) node = node();
  }, true);
  node && (node.$s = stop);
  return node;
};

/*----- Control flow -----*/
// Compiler guarantees thunks: cond/renderFn/fallback are () => ... (or static fallback node).
export const If = (cond, renderFn, fallback = null) => {
  let cached, current;
  return () => {
    const show = cond();
    if (show !== current) {
      cached = show ? render(renderFn) : isFn(fallback) ? render(fallback) : fallback;
    }
    current = show;
    return cached;
  };
};

// <Show when={...} fallback={...}>...</Show> — plugin auto-thunks `when`,
// but signals and plain values work too.
export const Show = (props) => {
  const kids = kidArray(props.children);
  const when = isFn(props.when) ? props.when : () => props.when?.value ?? props.when;
  return If(when, () => kids, props.fallback ?? null);
};

export const For = (list, key, renderFn) => {
  let cache = new Map();
  return () => {
    const next = new Map();
    const nodes = (isFn(list) ? list() : list.value || list).map((item, index) => {
      const idx = isFn(key) ? key(item, index) : key ? item[key] : item;
      let node = cache.get(idx);
      if (!node) node = render(renderFn, item, index);
      next.set(idx, node);
      return node;
    });
    cache = next;
    return nodes;
  };
};

export const Component = (props) => {
  const { is, children, ...rest } = props;
  return () => h(isFn(is) ? is() : is, { ...rest, children }, children);
};

export const Transition = (props) => {
  const { enter: e, idle, leave: l } = props;
  const [c] = kidArray(props.children);
  const decorate = (el) => {
    if (!isNode(el)) return el;
    const addClass = (x) => x && el.classList.add(...x.split(' '));
    const removeClass = (x) => x && el.classList.remove(...x.split(' '));
    if (e) {
      requestAnimationFrame(() => {
        addClass(e[1]);
        requestAnimationFrame(() => {
          addClass(e[0]);
          removeClass(e[1]);
          addClass(e[2]);
          el.addEventListener('transitionend', () => {
            removeClass(e[2]);
            removeClass(e[0]);
            addClass(idle);
          }, { once: true });
        });
      });
    }
    if (l) {
      el.$l = (done) => {
        removeClass(idle);
        addClass(l[1]);
        requestAnimationFrame(() => {
          addClass(l[0]);
          removeClass(l[1]);
          addClass(l[2]);
          el.addEventListener('transitionend', () => {
            removeClass(l[2]);
            removeClass(l[0]);
            done();
          }, { once: true });
        });
      };
    }
    return el;
  };
  if (!c) return null;
  if (isFn(c))
    return () => {
      // Resolve through helper thunks (If/Show/For return thunks, not
      // nodes). Without this, decorate() receives a function and bails,
      // so transitions around conditionals never animate.
      let n = c();
      while (isFn(n)) n = n();
      if (n === null || n === undefined || n === false) return n;
      const list = Array.isArray(n) ? n.flat(Infinity) : [n];
      list.forEach(decorate);
      return Array.isArray(n) ? list : list[0];
    };
  return decorate(c);
};

export default (target, root, props) => {
  const el = h(root, props);
  if (isFn(el) || Array.isArray(el)) {
    // fragment/array root reuses the dynamic append path; unmount stops the
    // root component's scope, the anchor scope, then removes top-level nodes
    // (running $s/onUnmount/$l).
    const stop = append(target, el);
    fireMounts(target, true);
    return () => {
      el.$s?.();
      stop?.();
      [...target.childNodes].forEach((n) => remove(n, false));
    };
  }
  target.appendChild(el);
  // Flush hooks deferred during construction (nested inserts into the
  // detached tree), children first, so onMount observes attached nodes.
  fireMounts(el, true);
  return () => remove(el, false);
};

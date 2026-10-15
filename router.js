/* bsig/router — tree-shakeable router entry point.
 *
 * Lives in its own module so it is never part of the runtime bundle: the
 * runtime does not import it, and a build that never imports `bsig/router`
 * drops everything here (package.json declares `sideEffects: false`).
 *
 * Built on the History API (`pushState`/`replaceState`, a `popstate`
 * listener, and a document-level click interceptor), so it behaves identically
 * in every browser — Safari, Firefox, Chromium, WebViews — with one code path
 * and no Navigation API dependency. Guards run before the URL commits, so
 * blocks and redirects never flicker. Per-entry scroll keys are stamped onto
 * `history.state` (the History API ships none of its own).
 */
import { h, signal, provide, inject, onUnmount } from './runtime.js';
// Vendored (MIT) so the router stays dependency-free; see vendor/regexparam.js.
import { parse } from './vendor/regexparam.js';

export const lazy = (loader, loading) => {
  let Component = null;
  let started = false;
  const loaded = signal(false);

  const start = () => {
    if (started) return;
    started = true;
    loader()
      .then((mod) => {
        Component = mod.default;
        loaded.value = true;
      })
      .catch(() => {
        started = false;
      });
  };

  const LazyComponent = (props) => () => {
    start();
    return loaded.value && Component ? h(Component, props) : (loading ?? null);
  };

  LazyComponent.preload = start;
  return LazyComponent;
};

const DEPTH = Symbol('router.depth');

let activeRouter = null;

const join = (base, path) => {
  if (!path || path === '/') return base || '/';
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
};

const matcherCache = new Map();

const matcher = (path, loose) => {
  const cacheKey = `${loose ? '~' : ''}${path}`;
  let cached = matcherCache.get(cacheKey);
  if (!cached) {
    cached = parse(path, loose);
    matcherCache.set(cacheKey, cached);
  }
  return (pathname) => {
    const m = cached.pattern.exec(pathname);
    if (!m) return null;
    const keys = cached.keys;
    const params = {};
    for (let i = 0; i < keys.length; i++) {
      const v = m[i + 1];
      if (v !== undefined) params[keys[i]] = decodeURIComponent(v);
    }
    return { params };
  };
};

export const matchTree = (routes, pathname, base) => {
  for (const route of routes) {
    const full = join(base, route.path);
    const hasChildren = !!route.children?.length;
    const result = matcher(full, hasChildren)(pathname);
    if (!result) continue;
    const entry = { route, path: full, base, params: result.params };
    if (hasChildren) {
      const child = matchTree(route.children, pathname, full);
      if (child) return [entry, ...child];
      if (matcher(full, false)(pathname)) return [entry];
      continue;
    }
    return [entry];
  }
  return null;
};

const RouteNode = ({ route, depth, params }) => {
  // Provide the depth so a nested `<Outlet/>` inside `route.component` resolves
  // to the next matched route.
  provide(DEPTH, depth);
  // Return an array, not the node itself: `h()` stamps the *outer* component's
  // context onto a value it receives from a nested component (`h(RouteNode)`
  // would overwrite the page's `$c` and silently drop its `onMount`/`onUnmount`,
  // including `createQuery` observer release). The append path flattens arrays,
  // so the page keeps its own context while still being a dynamic child.
  return [h(route.component, { params, route })];
};

export function createRouter(options) {
  const pathname = signal('');
  const matched = signal([]);

  // The browser's built-in scroll restoration races the async route render: a
  // lazy page mounts a short loading placeholder first, so the restored offset
  // gets clamped and a fresh entry can keep the previous page's scroll. Drive
  // it ourselves: remember the offset we leave each entry at, scroll to top on
  // push/replace, and re-apply the remembered offset on traversal until the
  // page is tall enough to hold it.
  const history_api = globalThis.history;
  history_api.scrollRestoration = 'manual';

  const scroll_positions = new Map();
  let scroll_token = 0;

  const restore_scroll = (target) => {
    const token = ++scroll_token;
    if (target <= 0) {
      window.scrollTo(0, 0);
      return;
    }
    // A manual scroll means the user took over — stop chasing the old offset.
    const abort = new AbortController();
    const stop = () => abort.abort();
    addEventListener('wheel', stop, { passive: true, signal: abort.signal });
    addEventListener('touchstart', stop, {
      passive: true,
      signal: abort.signal,
    });
    addEventListener('keydown', stop, { signal: abort.signal });
    let frames = 0;
    const step = () => {
      if (abort.signal.aborted || scroll_token !== token) return;
      window.scrollTo(0, target);
      if (window.scrollY >= target - 1 || ++frames >= 60) {
        abort.abort();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const render = (target) => {
    const result = matchTree(
      options.routes.children ?? [],
      target,
      options.routes.path,
    );
    if (result) {
      matched.value = result;
    } else if (options.notFound) {
      matched.value = [
        { route: options.notFound, path: target, base: '', params: {} },
      ];
    } else {
      matched.value = [];
    }
  };

  // The History API has no per-entry keys, so stamp our own onto
  // `history.state`. Keys drive scroll restoration; entries the router did not
  // create are tracked with memory-only keys (see `traverse`).
  const STATE_KEY = 'bsig:key';
  let key_seq = 0;
  const new_key = () => `k${++key_seq}`;
  let current_key = null;
  let current_href = '/';
  // Guards are async: a slow navigation superseded by a newer one must not
  // commit. Every navigation takes a token; only the latest may apply.
  let nav_token = 0;

  const entry_key = () => {
    const s = history_api.state;
    return s && typeof s === 'object' ? s[STATE_KEY] : undefined;
  };

  const stamp = (key) => {
    const s = history_api.state;
    history_api.replaceState(
      s && typeof s === 'object' ? { ...s, [STATE_KEY]: key } : { [STATE_KEY]: key },
      '',
    );
  };

  const collectGuards = (target) => {
    const guards = [];
    if (options.beforeEnter) guards.push(options.beforeEnter);
    if (options.routes.beforeEnter) guards.push(options.routes.beforeEnter);
    const chain =
      matchTree(options.routes.children ?? [], target, options.routes.path) ??
      (options.notFound
        ? [{ route: options.notFound, path: target, base: '', params: {} }]
        : []);
    for (const entry of chain) {
      if (entry.route.beforeEnter) guards.push(entry.route.beforeEnter);
    }
    return guards;
  };

  const runGuards = async (guards, to, from) => {
    const results = await Promise.all(
      guards.map((guard) => guard({ to, from })),
    );
    for (const result of results) {
      if (result === false) return { type: 'block' };
      if (typeof result === 'string')
        return { type: 'redirect', path: result, replace: false };
      if (result && typeof result === 'object')
        return {
          type: 'redirect',
          path: result.path,
          replace: !!result.replace,
        };
    }
    return null;
  };

  // Split a target into the pathname matching and guards see and the full
  // same-origin href the address bar shows.
  const split = (to) => {
    const url = new URL(to, window.location.href);
    return { path: url.pathname, href: url.pathname + url.search };
  };

  const resolve = async (to, seen, replace) => {
    const { path, href } = split(to);
    if (seen.has(path)) return null;
    seen.add(path);
    const verdict = await runGuards(collectGuards(path), path, pathname.value);
    if (verdict === null) return { path, href, replace };
    if (verdict.type === 'block') return null;
    return resolve(verdict.path, seen, verdict.replace);
  };

  const apply = (target) => {
    render(target.path);
    pathname.value = target.path;
  };

  const commit_push = (target) => {
    scroll_positions.set(current_key, window.scrollY);
    const key = new_key();
    history_api.pushState({ [STATE_KEY]: key }, '', target.href);
    current_key = key;
    current_href = target.href;
    apply(target);
    restore_scroll(0);
  };

  const commit_replace = (target) => {
    scroll_positions.set(current_key, window.scrollY);
    const key = new_key();
    history_api.replaceState({ [STATE_KEY]: key }, '', target.href);
    // Boot always runs first, so there is an entry to rewrite.
    current_key = key;
    current_href = target.href;
    apply(target);
    restore_scroll(0);
  };

  const boot = async () => {
    const token = ++nav_token;
    const here = split(window.location.pathname + window.location.search);
    let key = entry_key();
    if (!key) {
      key = new_key();
      stamp(key);
    }
    current_key = key;
    current_href = here.href;
    const target = await resolve(here.href, new Set(), false);
    if (token !== nav_token || !target) return;
    if (target.href !== here.href) {
      // A boot-time guard redirect (e.g. signed-out → Login) renders the
      // target, so the address bar must agree with it. A rewrite, not a new
      // entry — the user never navigated anywhere.
      history_api.replaceState({ [STATE_KEY]: key }, '', target.href);
      current_href = target.href;
    }
    apply(target);
  };

  const navigate = async (to, { replace = false } = {}) => {
    const token = ++nav_token;
    // A throwing guard fails the navigation, like a block.
    const target = await resolve(to, new Set(), replace).catch(() => null);
    if (token !== nav_token || target === null) return false;
    if (target.replace) commit_replace(target);
    else commit_push(target);
    return true;
  };

  const traverse = async () => {
    const token = ++nav_token;
    const here = split(window.location.pathname + window.location.search);
    let key = entry_key();
    if (!key) {
      // An entry that predates the router (or was pushed outside it): track it
      // with a memory-only key rather than stamping state onto an entry the
      // router does not own. Adopted entries restore scroll-to-top; entries the
      // router creates carry their keys in `history.state`.
      key = new_key();
    }
    const target = await resolve(here.path, new Set(), false).catch(() => null);
    if (token !== nav_token) return;
    if (target === null) {
      // Blocked after the browser already moved: pin the URL back to the page
      // on screen. Display and address bar agree again; the entry keeps its
      // URL, so a later visit re-runs guards.
      history_api.replaceState({ [STATE_KEY]: key }, '', current_href);
      return;
    }
    if (target.href !== here.href) {
      // A guard redirected the traversal: rewrite the entry in place. The
      // rewritten entry has no remembered offset (any saved one belongs to the
      // pre-redirect page).
      scroll_positions.set(current_key, window.scrollY);
      scroll_positions.delete(key);
      history_api.replaceState({ [STATE_KEY]: key }, '', target.href);
      current_key = key;
      current_href = target.href;
      apply(target);
      restore_scroll(0);
      return;
    }
    scroll_positions.set(current_key, window.scrollY);
    current_key = key;
    current_href = here.href;
    apply(target);
    restore_scroll(scroll_positions.get(key) ?? 0);
  };

  const handleClick = (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const origin = event.target;
    const anchor =
      origin && typeof origin.closest === 'function' ? origin.closest('a[href]') : null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;
    let url;
    try {
      url = new URL(anchor.getAttribute('href'), window.location.href);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin) return;
    const here = window.location;
    // Same-page targets (hash links, re-clicks) stay native: the browser
    // scrolls without history churn.
    if (url.pathname === here.pathname && url.search === here.search) return;
    event.preventDefault();
    void navigate(url.pathname + url.search);
  };

  const handlePopState = () => {
    void traverse();
  };

  const prefetching = new Set();

  const prefetch = (to) => {
    if (prefetching.has(to)) return;
    prefetching.add(to);
    (async () => {
      try {
        await runGuards(collectGuards(to), to, pathname.value);
      } catch {
        // best-effort: guards may throw during a warm-up prefetch
      }
      const chain =
        matchTree(options.routes.children ?? [], to, options.routes.path) ?? [];
      for (const entry of chain) {
        entry.route.component?.preload?.();
      }
    })().finally(() => prefetching.delete(to));
  };

  const isActive = (to) => {
    const norm = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
    const c = norm(pathname.value ?? '');
    const t = norm(to);
    if (t === '/') return c === '/';
    return c === t || c.startsWith(t + '/');
  };

  const Link = (props) => {
    const { to, class: base_class, children, ...rest } = props;
    // `to` is usually a literal, but the plugin thunks dynamic props — read it
    // through a getter so a reactive target still works.
    const href = () => (typeof to === 'function' ? to() : to);
    const base = () =>
      (typeof base_class === 'function' ? base_class() : base_class) ?? '';
    // Active state is exposed as `aria-current` (never a merged `activeClass`
    // string): the consumer styles `[aria-current="page"]` in the components
    // layer, so no `!important` or runtime class-merging is needed.
    return h(
      'a',
      {
        href,
        class: base,
        'aria-current': () => (isActive(href()) ? 'page' : 'false'),
        onMouseEnter: () => prefetch(href()),
        onFocus: () => prefetch(href()),
        onPointerDown: () => prefetch(href()),
        ...rest,
      },
      children,
    );
  };

  const RouterView = () => {
    // Root depth is 0; every `<Outlet/>` below reads it and hands the next
    // route `depth + 1`.
    provide(DEPTH, 0);
    // Array return for the same reason as RouteNode: the outer `h()` must not
    // stomp the root layout's lifecycle context.
    return [h(options.routes.component, { route: options.routes })];
  };

  const Outlet = () => {
    const depth = inject(DEPTH, 0) ?? 0;
    let cached = [];
    return () => {
      const m = matched.value[depth];
      if (!m) return null;
      const key = `${m.path}|${JSON.stringify(m.params)}`;
      let node = cached.find(([k]) => k === key)?.[1];
      if (!node) {
        node = h(RouteNode, {
          route: m.route,
          depth: depth + 1,
          params: m.params,
        });
        cached = [[key, node]];
      }
      return node;
    };
  };

  const api = {
    RouterView,
    Outlet,
    navigate,
    handleClick,
    handlePopState,
    boot,
    Link,
    prefetch,
    isActive,
    pathname,
  };
  activeRouter = api;
  return api;
}

// The JSX plugin auto-thunks dynamic props, so a config prop passed by
// reference (`<Router routes={routes} />`) arrives as `() => routes`. Unwrap
// one level: config props are plain values, never live bindings.
const unwrap = (v) => (typeof v === 'function' ? v() : v);

// A guard is itself a function, so it may arrive either directly (written as a
// function expression, untouched by the plugin) or wrapped in a plugin thunk
// (`beforeEnter={guard}` -> `() => guard`). Resolve at call time: a thunk is
// zero-arg and returns the guard, while a real zero-arg guard returns its
// verdict. Calling it lazily avoids invoking a guard during setup.
const asGuard = (v) => {
  if (typeof v !== 'function' || v.length > 0) return v;
  return (ctx) => {
    const guard = v();
    return typeof guard === 'function' ? guard(ctx) : guard;
  };
};

export const Router = (props) => {
  const router =
    unwrap(props.router) ??
    createRouter({
      routes: unwrap(props.routes),
      notFound: unwrap(props.notFound),
      beforeEnter: asGuard(props.beforeEnter),
    });
  activeRouter = router;
  // One document-level click interceptor owns every same-document link (plain
  // anchors too, not just `<Link>`); `popstate` owns back/forward. Both are
  // removed when the router unmounts.
  document.addEventListener('click', router.handleClick);
  window.addEventListener('popstate', router.handlePopState);
  onUnmount(() => {
    document.removeEventListener('click', router.handleClick);
    window.removeEventListener('popstate', router.handlePopState);
  });
  router.boot();
  // Render the root layout in `<Router />`'s own context. `h(router.RouterView)`
  // returns the layout through RouterView's array return, so the layout's
  // lifecycle context survives.
  return h(router.RouterView, {});
};

export const Outlet = () => (activeRouter ? activeRouter.Outlet() : null);

export const Link = (props) =>
  activeRouter ? activeRouter.Link(props) : null;

/* bsig/router — tree-shakeable router entry point.
 *
 * Lives in its own module so it is never part of the runtime bundle: the
 * runtime does not import it, and a build that never imports `bsig/router`
 * drops everything here (package.json declares `sideEffects: false`).
 *
 * Built on the Navigation API (`window.navigation`): interception, precommit
 * guards, traversal entries and per-entry scroll keys all come from it. Where
 * it is unavailable the router still boots and renders (boot uses the History
 * API directly); it just cannot intercept in-page navigations and warns once.
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
  if (history_api) history_api.scrollRestoration = 'manual';

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

  const resolve = async (path, seen, replace) => {
    if (seen.has(path)) return null;
    seen.add(path);
    const verdict = await runGuards(collectGuards(path), path, pathname.value);
    if (verdict === null) return { path, replace };
    if (verdict.type === 'block') return null;
    return resolve(verdict.path, seen, verdict.replace);
  };

  const apply = (target) => {
    render(target.path);
    pathname.value = target.path;
  };

  const boot = async () => {
    const start = window.location.pathname;
    const target = await resolve(start, new Set(), false);
    if (!target) return;
    if (target.path !== start) {
      // A boot-time guard redirect (e.g. unclaimed → Claim) renders the
      // target, so the address bar must agree with it. A rewrite, not a new
      // entry — the user never navigated anywhere.
      history_api.replaceState(null, '', target.path);
    }
    apply(target);
  };

  const navigate = (to, { replace = false } = {}) => {
    const nav = window.navigation;
    if (!nav) {
      // No Navigation API: fall back to a full navigation so links still work.
      if (replace) window.location.replace(to);
      else window.location.assign(to);
      return Promise.resolve(true);
    }
    const res = nav.navigate(to, {
      history: replace ? 'replace' : 'push',
    });
    res.committed?.catch(() => {});
    return res.finished.then(
      () => true,
      () => false,
    );
  };

  const handleNavigate = (event) => {
    if (
      !event.canIntercept ||
      event.hashChange ||
      event.downloadRequest !== null ||
      event.formData ||
      event.navigationType === 'reload'
    )
      return;

    const to = new URL(event.destination.url).pathname;
    const leaving_key = window.navigation.currentEntry?.key;
    const leaving_y = window.scrollY;
    let target = null;

    event.intercept({
      async precommitHandler(controller) {
        target = await resolve(to, new Set(), false);
        if (event.signal.aborted) return;
        if (target === null) throw new Error('blocked');
        if (target.path !== to)
          controller.redirect(
            target.path,
            target.replace ? { history: 'replace' } : undefined,
          );
      },
      handler() {
        if (event.signal.aborted) return;
        if (leaving_key) scroll_positions.set(leaving_key, leaving_y);
        apply(target ?? { path: to });
        restore_scroll(
          event.navigationType === 'traverse'
            ? (scroll_positions.get(event.destination.key) ?? 0)
            : 0,
        );
      },
    });
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
    handleNavigate,
    boot,
    Link,
    prefetch,
    isActive,
    pathname,
  };
  activeRouter = api;
  return api;
}

export const Router = (props) => {
  const router =
    props.router ??
    createRouter({
      routes: props.routes,
      notFound: props.notFound,
      beforeEnter: props.beforeEnter,
    });
  activeRouter = router;
  const nav = window.navigation;
  if (nav) {
    nav.addEventListener('navigate', router.handleNavigate);
    onUnmount(() => nav.removeEventListener('navigate', router.handleNavigate));
  } else if (typeof console !== 'undefined') {
    console.warn(
      '[bsig/router] Navigation API unavailable; in-page links will not be intercepted.',
    );
  }
  router.boot();
  // Render the root layout in `<Router />`'s own context. `h(router.RouterView)`
  // returns the layout through RouterView's array return, so the layout's
  // lifecycle context survives.
  return h(router.RouterView, {});
};

export const Outlet = () => (activeRouter ? activeRouter.Outlet() : null);

export const Link = (props) =>
  activeRouter ? activeRouter.Link(props) : null;

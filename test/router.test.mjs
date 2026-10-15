import { describe, it, expect } from 'bun:test';
import { settle, useNavigation } from './helpers.ts';

// bsig/router is built on the Navigation API; happy-dom has none, so
// `useNavigation` installs the mock from helpers.ts.
async function setup(url = 'http://localhost/') {
  useNavigation(url);
  const rt = await import('../runtime.js');
  const router = await import('../router.js');
  return { rt, router };
}

// Mounts a router through <Router/> (the public path) and returns teardown.
function mountApp(rt, router, r) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const unmount = rt.default(target, () => h_(rt, router, r));
  return {
    target,
    unmount() {
      unmount();
      target.remove();
    },
  };
}
function h_(rt, router, r) {
  return rt.h(router.Router, { router: r });
}

describe('router: matchTree', () => {
  it('matches nested routes, params, and loose parents', async () => {
    const { router } = await setup();
    const routes = [
      {
        path: '/users',
        component: () => null,
        children: [{ path: '/:id', component: () => null }],
      },
      { path: '/about', component: () => null },
    ];
    const deep = router.matchTree(routes, '/users/42', '/');
    expect(deep.map((m) => m.path)).toEqual(['/users', '/users/:id']);
    expect(deep[1].params.id).toBe('42');
    const parentOnly = router.matchTree(routes, '/users', '/');
    expect(parentOnly.map((m) => m.path)).toEqual(['/users']);
    expect(router.matchTree(routes, '/nope', '/')).toBeNull();
  });

  it('skips a loose parent whose child and exact path both miss', async () => {
    const { router } = await setup();
    const routes = [
      {
        path: '/users',
        component: () => null,
        children: [{ path: '/:id', component: () => null }],
      },
      { path: '/about', component: () => null },
    ];
    // `/users` matches loosely (open-ended) so the parent is considered, but
    // its `/:id` child and its exact pattern both reject the extra segment.
    expect(router.matchTree(routes, '/users/42/extra', '/')).toBeNull();
  });

  it('renders an empty outlet for an unmatched path when there is no notFound', async () => {
    const { rt, router } = await setup('http://localhost/missing');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [{ path: '/', component: () => h('p', { class: 'home' }, 'home') }],
    };
    // No `notFound` configured: `render` clears the match list (line 160/161).
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.layout')).toBeTruthy();
    expect(app.target.querySelector('.home')).toBeNull();
    expect(r.pathname.value).toBe('/missing');
    app.unmount();
  });
});

describe('router: boot + render', () => {
  it('renders the matched route through the layout outlet', async () => {
    const { rt, router } = await setup('http://localhost/about');
    const { h } = rt;
    const About = () => h('p', { class: 'page' }, 'About');
    const Layout = () => h('div', { class: 'layout' }, h(router.Outlet, null));
    const r = router.createRouter({
      routes: { path: '/', component: Layout, children: [{ path: '/about', component: About }] },
    });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.page').textContent).toBe('About');
    app.unmount();
  });

  it('renders nested routes through nested outlets with correct params', async () => {
    const { rt, router } = await setup('http://localhost/users/42');
    const { h } = rt;
    const seen = [];
    const User = ({ params }) => {
      seen.push(params.id);
      return h('p', { class: 'user' }, `User ${params.id}`);
    };
    const Users = () => h('div', { class: 'users' }, 'Users', h(router.Outlet, null));
    const Layout = () => h('div', { class: 'layout' }, h(router.Outlet, null));
    const r = router.createRouter({
      routes: {
        path: '/',
        component: Layout,
        children: [
          {
            path: '/users',
            component: Users,
            children: [{ path: '/:id', component: User }],
          },
        ],
      },
    });
    const app = mountApp(rt, router, r);
    await settle();
    expect(seen).toEqual(['42']);
    expect(app.target.querySelector('.user').textContent).toBe('User 42');
    app.unmount();
  });

  it('uses notFound when nothing matches', async () => {
    const { rt, router } = await setup('http://localhost/missing');
    const { h } = rt;
    const Layout = () => h('div', null, h(router.Outlet, null));
    const NotFound = () => h('p', { class: 'nf' }, '404');
    const r = router.createRouter({
      routes: { path: '/', component: Layout, children: [] },
      notFound: { path: '', component: NotFound },
    });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.nf').textContent).toBe('404');
    app.unmount();
  });

  it('accepts routes directly and installs/removes the navigate listener', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [{ path: '/', component: () => h('p', { class: 'home' }, 'home') }],
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    // <Router routes={...}/> creates its own instance and sets activeRouter.
    const unmount = rt.default(target, () => h(router.Router, { routes }));
    await settle();
    expect(target.querySelector('.home').textContent).toBe('home');
    expect(window.navigation.listenerCount()).toBe(1);
    unmount();
    target.remove();
    expect(window.navigation.listenerCount()).toBe(0); // listener removed on unmount
  });
});

describe('router: guards', () => {
  it('boot-time redirect rewrites the address bar', async () => {
    const { rt, router } = await setup('http://localhost/admin');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        {
          path: '/admin',
          component: () => h('p', { class: 'admin' }, 'admin'),
          beforeEnter: () => '/login',
        },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    app.unmount();
  });

  it('blocks a navigation when a guard returns false', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        {
          path: '/secret',
          component: () => h('p', { class: 'secret' }, 'secret'),
          beforeEnter: () => false,
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.home').textContent).toBe('home');

    let intercepted = null;
    r.handleNavigate({
      canIntercept: true,
      hashChange: false,
      downloadRequest: null,
      formData: null,
      navigationType: 'push',
      destination: { url: 'http://localhost/secret', key: 'k1' },
      signal: new AbortController().signal,
      intercept(hh) {
        intercepted = hh;
      },
    });
    await expect(intercepted.precommitHandler({ redirect() {} })).rejects.toThrow();
    expect(app.target.querySelector('.home').textContent).toBe('home');
    expect(app.target.querySelector('.secret')).toBeNull();
    app.unmount();
  });

  it('honors an object redirect verdict at boot', async () => {
    const { rt, router } = await setup('http://localhost/admin');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        {
          path: '/admin',
          component: () => h('p', { class: 'admin' }, 'admin'),
          beforeEnter: () => ({ path: '/login', replace: true }),
        },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    app.unmount();
  });

  it('redirects an intercepted navigation when a guard rewrites the target', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        {
          path: '/admin',
          component: () => h('p', { class: 'admin' }, 'admin'),
          beforeEnter: () => ({ path: '/login', replace: true }),
        },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();

    let intercepted = null;
    r.handleNavigate({
      canIntercept: true,
      hashChange: false,
      downloadRequest: null,
      formData: null,
      navigationType: 'push',
      destination: { url: 'http://localhost/admin', key: 'k-admin' },
      signal: new AbortController().signal,
      intercept(hh) {
        intercepted = hh;
      },
    });
    let redirected = null;
    await intercepted.precommitHandler({
      redirect(path, opts) {
        redirected = { path, opts };
      },
    });
    expect(redirected).toEqual({ path: '/login', opts: { history: 'replace' } });
    app.unmount();
  });

  it('unwraps a thunked beforeEnter guard passed to <Router/>', async () => {
    const { rt, router } = await setup('http://localhost/admin');
    const { h } = rt;
    const guard = ({ to }) => (to === '/admin' ? '/login' : true);
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/admin', component: () => h('p', { class: 'admin' }, 'admin') },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    // The JSX plugin delivers `beforeEnter={guard}` as the zero-arg thunk
    // `() => guard`; `asGuard` must unwrap it and call the real guard.
    const unmount = rt.default(target, () =>
      h(router.Router, { routes, beforeEnter: () => guard }),
    );
    await settle();
    expect(target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    unmount();
    target.remove();
  });
});

describe('router: Link + navigate', () => {
  it('Link sets href/aria-current and navigate() swaps the page', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () =>
        h(
          'div',
          null,
          h(router.Outlet, null),
          h(router.Link, { to: '/about', id: 'about-link' }, 'about'),
        ),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        { path: '/about', component: () => h('p', { class: 'about' }, 'about') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    const link = app.target.querySelector('#about-link');
    expect(link.getAttribute('href')).toBe('/about');
    expect(link.getAttribute('aria-current')).toBe('false');
    expect(app.target.querySelector('.home').textContent).toBe('home');

    expect(await r.navigate('/about')).toBe(true);
    await settle();
    expect(app.target.querySelector('.about').textContent).toBe('about');
    expect(link.getAttribute('aria-current')).toBe('page');
    app.unmount();
  });

  it('prefetch runs guards and component preload', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let preloaded = false;
    const Heavy = Object.assign(() => h('p', null, 'heavy'), {
      preload: () => (preloaded = true),
    });
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', null, 'home') },
        { path: '/heavy', component: Heavy },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    r.prefetch('/heavy');
    await settle();
    expect(preloaded).toBe(true);
    app.unmount();
  });

  it('Link prefetches on pointer enter, focus, and pointer down', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let preloads = 0;
    const Heavy = Object.assign(() => h('p', { class: 'heavy' }, 'heavy'), {
      preload: () => {
        preloads += 1;
      },
    });
    const routes = {
      path: '/',
      component: () =>
        h(
          'div',
          null,
          h(router.Outlet, null),
          h(router.Link, { to: '/heavy', id: 'heavy-link' }, 'heavy'),
        ),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        { path: '/heavy', component: Heavy },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    const link = app.target.querySelector('#heavy-link');
    for (const type of ['mouseenter', 'focus', 'pointerdown']) {
      link.dispatchEvent(new Event(type));
      await settle(); // let prefetch finish so the next event starts a fresh one
    }
    expect(preloads).toBe(3);
    app.unmount();
  });
});

describe('router: module-level Outlet and Link', () => {
  it('delegate to the active router', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [{ path: '/', component: () => h('p', { class: 'home' }, 'home') }],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    // The bare exports (`bsig/router`'s `Outlet`/`Link`) resolve through the
    // `activeRouter` that createRouter installs.
    expect(typeof router.Outlet()).toBe('function');
    const link = router.Link({ to: '/', children: 'home' });
    expect(link.getAttribute('href')).toBe('/');
    app.unmount();
  });
});

describe('router: lifecycle', () => {
  it('page onUnmount runs when navigating away and when the app unmounts', async () => {
    const { rt, router } = await setup('http://localhost/a');
    const { h, onUnmount, signal } = rt;
    const events = [];
    const later = signal('x');
    const PageA = () => {
      const el = h('p', { class: 'a' }, () => `A${later.value}`);
      onUnmount(() => events.push('A'));
      return el;
    };
    const PageB = () => {
      onUnmount(() => events.push('B'));
      return h('p', { class: 'b' }, 'B');
    };
    const Layout = () => {
      onUnmount(() => events.push('layout'));
      return h('div', null, h(router.Outlet, null));
    };
    const routes = {
      path: '/',
      component: Layout,
      children: [
        { path: '/a', component: PageA },
        { path: '/b', component: PageB },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    const a = app.target.querySelector('.a');
    expect(a.textContent).toBe('Ax');

    // Navigate away: PageA's scope must stop, so its effect no longer runs.
    await r.navigate('/b');
    await settle();
    expect(events).toEqual(['A']);
    later.value = 'y';
    await settle();
    expect(a.textContent).toBe('Ax');

    // Unmounting the app stops the layout and the current page.
    app.unmount();
    expect(events).toEqual(['A', 'layout', 'B']);
  });

  it('unmounts the nested chain when navigating to a shallower route', async () => {
    const { rt, router } = await setup('http://localhost/users/42');
    const { h, onUnmount } = rt;
    const events = [];
    const User = () => {
      onUnmount(() => events.push('user'));
      return h('p', { class: 'user' }, 'u');
    };
    const Users = () => {
      onUnmount(() => events.push('users'));
      return h('div', null, h(router.Outlet, null));
    };
    const About = () => h('p', { class: 'about' }, 'about');
    const Layout = () => h('div', null, h(router.Outlet, null));
    const r = router.createRouter({
      routes: {
        path: '/',
        component: Layout,
        children: [
          {
            path: '/users',
            component: Users,
            children: [{ path: '/:id', component: User }],
          },
          { path: '/about', component: About },
        ],
      },
    });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.user').textContent).toBe('u');
    await r.navigate('/about');
    await settle();
    expect(events).toEqual(['users', 'user']);
    expect(app.target.querySelector('.about').textContent).toBe('about');
    app.unmount();
  });
});

describe('router: lazy', () => {
  it('renders loading, then the loaded component', async () => {
    const { rt, router } = await setup('http://localhost/lazy');
    const { h } = rt;
    let release;
    const pending = new Promise((res) => (release = res));
    const Loaded = () => h('p', { class: 'loaded' }, 'loaded');
    const Lazy = router.lazy(() => pending.then(() => ({ default: Loaded })), h('p', { class: 'loading' }, 'loading'));
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [{ path: '/lazy', component: Lazy }],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.loading')).toBeTruthy(); // loading placeholder first
    release();
    await settle();
    expect(app.target.querySelector('.loaded').textContent).toBe('loaded');
    app.unmount();
  });

  it('keeps the placeholder when a chunk fails, then retries on the next preload', async () => {
    const { rt, router } = await setup('http://localhost/lazy');
    const { h } = rt;
    let attempts = 0;
    const Loaded = () => h('p', { class: 'loaded' }, 'loaded');
    const Lazy = router.lazy(() => {
      attempts += 1;
      // First load rejects: the placeholder must stay and the loader must be
      // re-armed so a later preload can retry the chunk.
      return attempts === 1
        ? Promise.reject(new Error('chunk failed'))
        : Promise.resolve({ default: Loaded });
    }, h('p', { class: 'loading' }, 'loading'));
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [{ path: '/lazy', component: Lazy }],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.loading')).toBeTruthy();
    expect(app.target.querySelector('.loaded')).toBeNull();

    Lazy.preload(); // rejection reset `started`, so this second attempt runs
    await settle();
    expect(attempts).toBe(2);
    expect(app.target.querySelector('.loaded').textContent).toBe('loaded');
    app.unmount();
  });
});

describe('router: Navigation API fallbacks', () => {
  it('navigate() falls back to full navigation when the API is absent', async () => {
    const { router } = await setup('http://localhost/');
    const r = router.createRouter({
      routes: { path: '/', component: () => null, children: [] },
    });

    const saved = window.navigation;
    const assigns = [];
    const replaces = [];
    const origAssign = window.location.assign;
    const origReplace = window.location.replace;
    delete window.navigation;
    window.location.assign = (to) => assigns.push(to);
    window.location.replace = (to) => replaces.push(to);
    try {
      expect(await r.navigate('/x')).toBe(true);
      expect(await r.navigate('/y', { replace: true })).toBe(true);
    } finally {
      window.navigation = saved;
      window.location.assign = origAssign;
      window.location.replace = origReplace;
    }
    expect(assigns).toEqual(['/x']);
    expect(replaces).toEqual(['/y']);
  });

  it('resolves false when a navigation is aborted, and swallows committed rejections', async () => {
    const { router } = await setup('http://localhost/');
    const r = router.createRouter({
      routes: { path: '/', component: () => null, children: [] },
    });
    const saved = window.navigation;
    window.navigation = {
      navigate: () => ({
        committed: Promise.reject(new Error('blocked')),
        finished: Promise.reject(new Error('aborted')),
      }),
    };
    try {
      expect(await r.navigate('/x')).toBe(false);
    } finally {
      window.navigation = saved;
    }
  });

  it('warns once when mounting without the Navigation API', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const saved = window.navigation;
    const origWarn = console.warn;
    const warned = [];
    delete window.navigation;
    console.warn = (...args) => warned.push(args.join(' '));

    const target = document.createElement('div');
    document.body.appendChild(target);
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [],
    };
    let unmount;
    try {
      unmount = rt.default(target, () => h(router.Router, { routes }));
      await settle();
    } finally {
      unmount?.();
      target.remove();
      window.navigation = saved;
      console.warn = origWarn;
    }
    expect(warned.some((w) => w.includes('Navigation API unavailable'))).toBe(true);
  });
});

describe('router: scroll restoration', () => {
  it('re-applies a saved offset on traversal and stops on manual scroll', async () => {
    const { rt, router } = await setup('http://localhost/a');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/a', component: () => h('p', { class: 'a' }, 'a') },
        { path: '/b', component: () => h('p', { class: 'b' }, 'b') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();

    // A controllable scroll environment: scrollY is a mutable getter and
    // animation frames are queued so each step can be inspected.
    let scrollY = 0;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
      set: (v) => {
        scrollY = v;
      },
    });
    const origScrollTo = window.scrollTo;
    const scrollCalls = [];
    window.scrollTo = (x, y) => scrollCalls.push([x, y]);
    const origRaf = globalThis.requestAnimationFrame;
    const rafQueue = [];
    globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);
    const frame = () => rafQueue.shift()?.();
    const nav = window.navigation;
    const savedEntry = nav.currentEntry;

    const dispatch = (type, to, key) => {
      let handlers;
      r.handleNavigate({
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        formData: null,
        navigationType: type,
        destination: { url: `http://localhost${to}`, key },
        signal: new AbortController().signal,
        intercept(hh) {
          handlers = hh;
        },
      });
      return handlers;
    };

    try {
      // Leave /a while scrolled down: the offset is remembered under entry k-a.
      nav.currentEntry = { key: 'k-a' };
      scrollY = 100;
      dispatch('push', '/b', 'k-b').handler();
      await settle();
      expect(app.target.querySelector('.b').textContent).toBe('b');
      expect(scrollCalls).toContainEqual([0, 0]); // push scrolls to top

      // Traverse back: the short page is chased frame by frame...
      nav.currentEntry = { key: 'k-b' };
      scrollY = 0; // the fresh render starts at the top
      dispatch('traverse', '/a', 'k-a').handler();
      await settle();
      frame();
      expect(rafQueue.length).toBe(1); // still short, so it schedules again
      scrollY = 100; // now the offset fits
      frame();
      expect(rafQueue.length).toBe(0); // and the chase stops

      // A manual scroll aborts an in-flight restore: the queued step no-ops.
      nav.currentEntry = { key: 'k-b' };
      dispatch('traverse', '/a', 'k-a').handler();
      await settle();
      window.dispatchEvent(new Event('wheel'));
      frame();
      expect(rafQueue.length).toBe(0);

      // If the page never grows, the chase gives up after ~1s of frames.
      scrollY = 0;
      nav.currentEntry = { key: 'k-b' };
      dispatch('traverse', '/a', 'k-a').handler();
      for (let i = 0; i < 60; i++) frame();
      expect(rafQueue.length).toBe(0);
    } finally {
      delete window.scrollY;
      window.scrollTo = origScrollTo;
      globalThis.requestAnimationFrame = origRaf;
      nav.currentEntry = savedEntry;
      app.unmount();
    }
  });
});

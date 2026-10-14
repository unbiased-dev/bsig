import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// bsig/router is built on the Navigation API; jsdom has none, so we install a
// minimal mock that dispatches `navigate` to the router's handler and resolves
// the committed/finished promises like a real push.
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 4; i++) await flush();
};

function makeNavigation(win) {
  const listeners = new Set();
  let seq = 0;
  return {
    currentEntry: { key: 'entry-0' },
    listenerCount: () => listeners.size,
    addEventListener(type, fn) {
      if (type === 'navigate') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'navigate') listeners.delete(fn);
    },
    navigate(url, opts = {}) {
      const abs = new URL(url, win.location.href);
      let intercepted = null;
      const ev = {
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        formData: null,
        navigationType: opts.history === 'traverse' ? 'traverse' : 'push',
        destination: { url: abs.href, key: 'entry-' + ++seq },
        signal: new AbortController().signal,
        intercept(h) {
          intercepted = h;
        },
      };
      let resolve_committed, reject_committed, resolve_finished;
      const committed = new Promise((res, rej) => {
        resolve_committed = res;
        reject_committed = rej;
      });
      const finished = new Promise((res) => {
        resolve_finished = res;
      });
      (async () => {
        for (const fn of [...listeners]) fn(ev);
        try {
          if (intercepted?.precommitHandler)
            await intercepted.precommitHandler({
              redirect(path) {
                win.history.replaceState(null, '', path);
              },
            });
          win.history.pushState(null, '', abs.pathname + abs.search);
          resolve_committed();
          if (intercepted?.handler) intercepted.handler();
        } catch (err) {
          reject_committed(err);
        } finally {
          resolve_finished();
        }
      })();
      return { committed, finished };
    },
  };
}

async function setup(url = 'http://localhost/') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.history = dom.window.history;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
  dom.window.scrollTo = () => {};
  dom.window.navigation = makeNavigation(dom.window);
  const rt = await import('../runtime.js');
  const router = await import('../router.js');
  return { dom, rt, router };
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
    assert.deepEqual(
      deep.map((m) => m.path),
      ['/users', '/users/:id'],
    );
    assert.equal(deep[1].params.id, '42');
    const parentOnly = router.matchTree(routes, '/users', '/');
    assert.deepEqual(
      parentOnly.map((m) => m.path),
      ['/users'],
    );
    assert.equal(router.matchTree(routes, '/nope', '/'), null);
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
    assert.equal(app.target.querySelector('.page').textContent, 'About');
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
    assert.deepEqual(seen, ['42']);
    assert.equal(app.target.querySelector('.user').textContent, 'User 42');
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
    assert.equal(app.target.querySelector('.nf').textContent, '404');
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
    assert.equal(target.querySelector('.home').textContent, 'home');
    assert.equal(window.navigation.listenerCount(), 1);
    unmount();
    target.remove();
    assert.equal(window.navigation.listenerCount(), 0, 'listener removed on unmount');
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
    assert.equal(app.target.querySelector('.login').textContent, 'login');
    assert.equal(window.location.pathname, '/login');
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
    assert.equal(app.target.querySelector('.home').textContent, 'home');

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
    await assert.rejects(() => intercepted.precommitHandler({ redirect() {} }));
    assert.equal(app.target.querySelector('.home').textContent, 'home');
    assert.equal(app.target.querySelector('.secret'), null);
    app.unmount();
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
    assert.equal(link.getAttribute('href'), '/about');
    assert.equal(link.getAttribute('aria-current'), 'false');
    assert.equal(app.target.querySelector('.home').textContent, 'home');

    assert.equal(await r.navigate('/about'), true);
    await settle();
    assert.equal(app.target.querySelector('.about').textContent, 'about');
    assert.equal(link.getAttribute('aria-current'), 'page');
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
    assert.equal(preloaded, true);
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
    assert.equal(a.textContent, 'Ax');

    // Navigate away: PageA's scope must stop, so its effect no longer runs.
    await r.navigate('/b');
    await settle();
    assert.deepEqual(events, ['A']);
    later.value = 'y';
    await settle();
    assert.equal(a.textContent, 'Ax');

    // Unmounting the app stops the layout and the current page.
    app.unmount();
    assert.deepEqual(events, ['A', 'layout', 'B']);
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
    assert.equal(app.target.querySelector('.user').textContent, 'u');
    await r.navigate('/about');
    await settle();
    assert.deepEqual(events, ['users', 'user']);
    assert.equal(app.target.querySelector('.about').textContent, 'about');
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
    assert.ok(app.target.querySelector('.loading'), 'loading placeholder first');
    release();
    await settle();
    assert.equal(app.target.querySelector('.loaded').textContent, 'loaded');
    app.unmount();
  });
});

import { describe, it, expect, afterEach } from 'bun:test';
import { settle, useHistory } from './helpers.ts';

// bsig/router drives the real History API, so there is no Navigation API mock:
// `useHistory` just points the shared happy-dom window at a URL. Entries
// persist across tests in this file (happy-dom never resets the stack), so
// each test pushes its own anchor entry and never traverses past it.
async function setup(url = 'http://localhost/') {
  useHistory(url);
  history.pushState({}, '', url);
  const rt = await import('../runtime.js');
  const router = await import('../router.js');
  return { rt, router };
}

// Mounts a router through <Router/> (the public path) and returns teardown.
// Teardowns are also flushed in afterEach: a failing test must not leak its
// document/popstate listeners into the next test's navigations.
const live = new Set();
afterEach(() => {
  for (const teardown of [...live]) {
    live.delete(teardown);
    try {
      teardown();
    } catch {}
  }
});

// Mounts a router through <Router/> (the public path) and returns teardown.
function mountApp(rt, router, r) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const unmount = rt.default(target, () => h_(rt, router, r));
  const app = {
    target,
    unmount() {
      unmount();
      target.remove();
    },
  };
  live.add(app.unmount);
  return app;
}
function h_(rt, router, r) {
  return rt.h(router.Router, { router: r });
}

// Dispatches a real bubbling click. Returns dispatchEvent's result: false when
// the router intercepted (preventDefault), true when left to the browser.
// Only safe for clicks the router prevents or same-document no-ops: happy-dom
// performs the default navigation for unprevented clicks (even cross-origin),
// so left-alone cases go through `handleClick` directly with a synthetic event
// instead — same decision logic, no document load.
function click(el, init = {}) {
  return el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ...init }),
  );
}

// A synthetic click for decision-table tests: real anchor target, no DOM
// dispatch, so the browser never navigates.
function fakeClick(target, init = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target,
    preventDefault() {},
    ...init,
  };
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

  it('keeps malformed percent escapes instead of throwing', async () => {
    const { router } = await setup();
    const chain = router.matchTree(
      [{ path: '/users/:id', component: () => null }],
      '/users/%E0%A4%A',
      '/',
    );
    expect(chain[0].params.id).toBe('%E0%A4%A');
  });
});

describe('router: boot + render', () => {
  it('renders the matched route through the layout outlet', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const About = () => h('p', { class: 'page' }, 'About');
    const Layout = () => h('div', { class: 'layout' }, h(router.Outlet, null));
    const r = router.createRouter({
      routes: { path: '/', component: Layout, children: [{ path: '/', component: () => h('p', { class: 'home' }, 'home') }] },
    });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.home').textContent).toBe('home');
    expect(r.pathname.value).toBe('/');
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

  it('renders an empty outlet for an unmatched path when there is no notFound', async () => {
    const { rt, router } = await setup('http://localhost/missing');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [{ path: '/', component: () => h('p', { class: 'home' }, 'home') }],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.layout')).toBeTruthy();
    expect(app.target.querySelector('.home')).toBeNull();
    expect(r.pathname.value).toBe('/missing');
    app.unmount();
  });

  it('stamps a key onto an entry that predates the router', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    // An entry pushed outside the router carries no key; boot must adopt it.
    history.pushState({}, '', '/adopted');
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [{ path: '/adopted', component: () => h('p', { class: 'page' }, 'adopted') }],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.page').textContent).toBe('adopted');
    expect(history.state['bsig:key']).toMatch(/^k\d+$/);
    app.unmount();
  });

  it('boot-time redirect rewrites the address bar without a new entry', async () => {
    const { rt, router } = await setup('http://localhost/admin');
    const { h } = rt;
    const before = history.length;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        {
          path: '/admin',
          component: () => h('p', { class: 'admin' }, 'admin'),
          guard: () => '/login',
        },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    expect(history.length).toBe(before); // rewrite, not a new entry
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
          guard: () => ({ path: '/login', replace: true }),
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

  it('renders nothing when a guard blocks at boot', async () => {
    const { rt, router } = await setup('http://localhost/locked');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [
        {
          path: '/locked',
          component: () => h('p', { class: 'locked' }, 'locked'),
          guard: () => false,
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.layout')).toBeTruthy();
    expect(app.target.querySelector('.locked')).toBeNull();
    expect(r.pathname.value).toBe('');
    app.unmount();
  });

  it('a throwing guard at boot does not reject and leaves the outlet empty', async () => {
    const { rt, router } = await setup('http://localhost/admin');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [
        {
          path: '/admin',
          component: () => h('p', { class: 'admin' }, 'admin'),
          guard: () => {
            throw new Error('guard blew up');
          },
        },
      ],
    };
    const r = router.createRouter({ routes });
    await r.boot(); // must resolve, not reject
    expect(r.pathname.value).toBe('');
  });

  it('renders a malformed percent escape in a param instead of failing boot', async () => {
    const { rt, router } = await setup('http://localhost/users/%E0%A4%A');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [
        {
          path: '/users/:id',
          component: ({ params }) => h('p', { class: 'user' }, params.id),
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(app.target.querySelector('.user').textContent).toBe('%E0%A4%A');
    expect(r.pathname.value).toBe('/users/%E0%A4%A');
    app.unmount();
  });

  it('a navigation that lands first supersedes a slow boot', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let release;
    const gate = new Promise((res) => (release = res));
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        { path: '/fast', component: () => h('p', { class: 'fast' }, 'fast') },
      ],
    };
    // The global guard holds every resolution until released.
    const r = router.createRouter({ routes, guard: () => gate.then(() => true) });
    const app = mountApp(rt, router, r);
    const pending = r.navigate('/fast');
    release();
    expect(await pending).toBe(true);
    await settle();
    expect(app.target.querySelector('.fast').textContent).toBe('fast');
    expect(r.pathname.value).toBe('/fast');
    app.unmount();
  });

  it('unwraps a thunked guard passed to <Router/>', async () => {
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
    // The JSX plugin delivers `guard={guard}` as the zero-arg thunk
    // `() => guard`; `asGuard` must unwrap it and call the real guard.
    const unmount = rt.default(target, () =>
      h(router.Router, { routes, guard: () => guard }),
    );
    live.add(() => {
      unmount();
      target.remove();
    });
    await settle();
    expect(target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    unmount();
    target.remove();
  });

  it('accepts routes directly and detaches its listeners on unmount', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        { path: '/about', component: () => h('p', { class: 'about' }, 'about') },
      ],
    };
    const target = document.createElement('div');
    document.body.appendChild(target);
    // <Router routes={...}/> creates its own instance and sets activeRouter.
    const unmount = rt.default(target, () => h(router.Router, { routes }));
    live.add(() => {
      unmount();
      target.remove();
    });
    await settle();
    expect(target.querySelector('.home').textContent).toBe('home');

    // A stray anchor in the live document proves the click interceptor is
    // gone after unmount (dispatchEvent returns true = not prevented).
    const stray = document.createElement('a');
    stray.href = '/about';
    document.body.appendChild(stray);
    unmount();
    target.remove();
    expect(click(stray)).toBe(true);
    stray.remove();

    // Back/forward is dead too: the URL moves but no render runs — a fresh
    // router boots cleanly at wherever the stack landed.
    window.happyDOM.setURL('http://localhost/');
    history.pushState({}, '', '/about');
    history.back();
    await settle();
    expect(window.location.pathname).toBe('/');
    const target2 = document.createElement('div');
    document.body.appendChild(target2);
    const unmount2 = rt.default(target2, () => h(router.Router, { routes }));
    live.add(() => {
      unmount2();
      target2.remove();
    });
    await settle();
    expect(target2.querySelector('.home').textContent).toBe('home');
    unmount2();
    target2.remove();
  });
});

describe('router: navigate', () => {
  async function navSetup() {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        { path: '/about', component: () => h('p', { class: 'about' }, 'about') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    return { r, app };
  }

  it('pushes a new entry, swaps the page, and updates the URL', async () => {
    const { r, app } = await navSetup();
    const before = history.length;
    expect(app.target.querySelector('.home').textContent).toBe('home');
    expect(await r.navigate('/about')).toBe(true);
    expect(app.target.querySelector('.about').textContent).toBe('about');
    expect(window.location.pathname).toBe('/about');
    expect(r.pathname.value).toBe('/about');
    expect(history.length).toBe(before + 1);
    app.unmount();
  });

  it('replace rewrites the entry instead of pushing', async () => {
    const { r, app } = await navSetup();
    const before = history.length;
    expect(await r.navigate('/about', { replace: true })).toBe(true);
    expect(app.target.querySelector('.about').textContent).toBe('about');
    expect(window.location.pathname).toBe('/about');
    expect(history.length).toBe(before);
    app.unmount();
  });

  it('blocks when a guard returns false', async () => {
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
          guard: () => false,
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(await r.navigate('/secret')).toBe(false);
    expect(app.target.querySelector('.home').textContent).toBe('home');
    expect(app.target.querySelector('.secret')).toBeNull();
    expect(window.location.pathname).toBe('/');
    app.unmount();
  });

  it('fails when a guard throws', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        {
          path: '/boom',
          component: () => h('p', { class: 'boom' }, 'boom'),
          guard: () => {
            throw new Error('guard blew up');
          },
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(await r.navigate('/boom')).toBe(false);
    expect(window.location.pathname).toBe('/');
    app.unmount();
  });

  it('follows a string redirect as a push', async () => {
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
          guard: () => '/login',
        },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    const before = history.length;
    expect(await r.navigate('/admin')).toBe(true);
    expect(app.target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    expect(history.length).toBe(before + 1);
    app.unmount();
  });

  it('follows an object redirect as a replace', async () => {
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
          guard: () => ({ path: '/login', replace: true }),
        },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    const before = history.length;
    expect(await r.navigate('/admin')).toBe(true);
    expect(app.target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    expect(history.length).toBe(before);
    app.unmount();
  });

  it('a slow navigation superseded by a newer one does not commit', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let release;
    const gate = new Promise((res) => (release = res));
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        {
          path: '/slow',
          component: () => h('p', { class: 'slow' }, 'slow'),
          guard: () => gate.then(() => true),
        },
        { path: '/fast', component: () => h('p', { class: 'fast' }, 'fast') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    const stale = r.navigate('/slow');
    expect(await r.navigate('/fast')).toBe(true);
    release();
    expect(await stale).toBe(false);
    await settle();
    expect(app.target.querySelector('.fast').textContent).toBe('fast');
    expect(window.location.pathname).toBe('/fast');
    app.unmount();
  });
});

describe('router: back/forward traversal', () => {
  it('back() and forward() move through rendered pages', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        { path: '/about', component: () => h('p', { class: 'about' }, 'about') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(await r.navigate('/about')).toBe(true);
    expect(app.target.querySelector('.about').textContent).toBe('about');
    history.back();
    await settle();
    expect(app.target.querySelector('.home').textContent).toBe('home');
    expect(window.location.pathname).toBe('/');
    expect(r.pathname.value).toBe('/');
    history.forward();
    await settle();
    expect(app.target.querySelector('.about').textContent).toBe('about');
    expect(window.location.pathname).toBe('/about');
    app.unmount();
  });

  it('a blocked traversal pins the URL back to the page on screen', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    // The home guard is open until the test closes it mid-history.
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        {
          path: '/',
          component: () => h('p', { class: 'home' }, 'home'),
          guard: () => window.__open !== false,
        },
        { path: '/about', component: () => h('p', { class: 'about' }, 'about') },
      ],
    };
    window.__open = true;
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(await r.navigate('/about')).toBe(true);
    window.__open = false; // now going back is blocked
    history.back();
    await settle();
    // The browser moved, the guard refused: URL pinned back, page untouched.
    expect(app.target.querySelector('.about').textContent).toBe('about');
    expect(window.location.pathname).toBe('/about');
    expect(r.pathname.value).toBe('/about');
    delete window.__open;
    app.unmount();
  });

  it('a blocked traversal preserves the entry state payload', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        {
          path: '/foreign',
          component: () => h('p', { class: 'foreign' }, 'foreign'),
          guard: () => window.__open !== false,
        },
      ],
    };
    window.__open = true;
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    // Adopt a foreign entry carrying a payload, then move off it.
    history.pushState({ marker: 1 }, '', '/foreign');
    history.pushState({}, '', '/x');
    window.__open = false; // the way back is now blocked
    history.back();
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(history.state.marker).toBe(1); // payload survived the pin
    delete window.__open;
    // Leave the shared stack tidy for the next test.
    expect(await r.navigate('/')).toBe(true);
    app.unmount();
  });

  it('a guard redirects a traversal by rewriting the entry', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        {
          path: '/',
          component: () => h('p', { class: 'home' }, 'home'),
          guard: () => window.__redir ?? true,
        },
        { path: '/about', component: () => h('p', { class: 'about' }, 'about') },
        { path: '/login', component: () => h('p', { class: 'login' }, 'login') },
      ],
    };
    window.__redir = true;
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(await r.navigate('/about')).toBe(true);
    window.__redir = '/login'; // the way back now detours
    history.back();
    await settle();
    expect(app.target.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
    delete window.__redir;
    app.unmount();
  });

  it('adopts entries pushed outside the router', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', { class: 'layout' }, h(router.Outlet, null)),
      children: [{ path: '/', component: () => h('p', { class: 'home' }, 'home') }],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    // External pushes carry no key; landing on them adopts them into the mirror.
    history.pushState({}, '', '/x');
    history.pushState({}, '', '/y');
    history.back();
    await settle();
    expect(r.pathname.value).toBe('/x');
    expect(app.target.querySelector('.layout')).toBeTruthy();
    history.forward();
    await settle();
    expect(r.pathname.value).toBe('/y');
    history.back();
    await settle();
    expect(r.pathname.value).toBe('/x');
    // Leave the shared stack tidy: a keyed entry with nothing ahead, so the
    // next test boots onto a clean forward stack.
    expect(await r.navigate('/')).toBe(true);
    expect(r.pathname.value).toBe('/');
    app.unmount();
  });

  it('a throwing guard fails a traversal like a block', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        {
          path: '/bad',
          component: () => h('p', { class: 'bad' }, 'bad'),
          guard: () => {
            throw new Error('guard blew up');
          },
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    // Reach the guarded path from outside (navigate() would fail too), then
    // traverse onto it: the throw pins the URL back to the page on screen.
    history.pushState({}, '', '/bad');
    history.pushState({}, '', '/x');
    history.back();
    await settle();
    expect(app.target.querySelector('.home').textContent).toBe('home');
    expect(window.location.pathname).toBe('/');
    expect(r.pathname.value).toBe('/');
    // Leave the shared stack tidy for the next test.
    expect(await r.navigate('/')).toBe(true);
    app.unmount();
  });

  it('a superseded traversal does not apply', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let release;
    const gate = new Promise((res) => (release = res));
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        {
          path: '/',
          component: () => h('p', { class: 'home' }, 'home'),
          guard: () => gate.then(() => true),
        },
        { path: '/fast', component: () => h('p', { class: 'fast' }, 'fast') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(await r.navigate('/fast')).toBe(true);
    // Move the URL like the browser does on back(), then run the popstate
    // handler directly so the slow guard is definitely in flight first.
    history.pushState({}, '', '/');
    r.handlePopState();
    expect(await r.navigate('/fast')).toBe(true);
    release();
    await settle();
    expect(app.target.querySelector('.fast').textContent).toBe('fast');
    expect(r.pathname.value).toBe('/fast');
    app.unmount();
  });
});

describe('router: click interception', () => {
  async function clickSetup() {
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
          h('a', { href: '/about', id: 'raw-link' }, 'raw'),
          h('a', { href: 'https://example.com/x', id: 'ext-link' }, 'ext'),
          h('a', { href: '/about', download: '', id: 'dl-link' }, 'dl'),
          h('a', { href: '#sec', id: 'hash-link' }, 'hash'),
          h('a', { href: 'http://[::1', id: 'bad-link' }, 'bad'),
        ),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        { path: '/about', component: () => h('p', { class: 'about' }, 'about') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    return { r, app };
  }

  it('<Link> clicks navigate client-side', async () => {
    const { r, app } = await clickSetup();
    const link = app.target.querySelector('#about-link');
    expect(link.getAttribute('href')).toBe('/about');
    expect(link.getAttribute('aria-current')).toBe('false');
    expect(click(link)).toBe(false); // intercepted
    await settle();
    expect(app.target.querySelector('.about').textContent).toBe('about');
    expect(window.location.pathname).toBe('/about');
    expect(r.pathname.value).toBe('/about');
    expect(link.getAttribute('aria-current')).toBe('page');
    app.unmount();
  });

  it('plain anchors are intercepted too', async () => {
    const { app } = await clickSetup();
    expect(click(app.target.querySelector('#raw-link'))).toBe(false);
    await settle();
    expect(app.target.querySelector('.about').textContent).toBe('about');
    expect(window.location.pathname).toBe('/about');
    app.unmount();
  });

  it('modifier and non-left clicks are left to the browser', async () => {
    const { r, app } = await clickSetup();
    const link = app.target.querySelector('#about-link');
    r.handleClick(fakeClick(link, { metaKey: true }));
    r.handleClick(fakeClick(link, { button: 1 }));
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(app.target.querySelector('.home').textContent).toBe('home');
    app.unmount();
  });

  it('targeted and download links are left alone', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const target = document.createElement('div');
    document.body.appendChild(target);
    target.appendChild(h('a', { href: '/about', target: '_blank', id: 't' }, 't'));
    target.appendChild(h('a', { href: '/about', download: '', id: 'd' }, 'd'));
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [{ path: '/', component: () => h('p', { class: 'home' }, 'home') }],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    // Direct calls: a real dispatch would make happy-dom load the target.
    r.handleClick(fakeClick(target.querySelector('#t')));
    r.handleClick(fakeClick(target.querySelector('#d')));
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(app.target.querySelector('.home').textContent).toBe('home');
    app.unmount();
    target.remove();
  });

  it('external, hash, and malformed hrefs are left alone', async () => {
    const { r, app } = await clickSetup();
    r.handleClick(fakeClick(app.target.querySelector('#ext-link')));
    r.handleClick(fakeClick(app.target.querySelector('#hash-link')));
    r.handleClick(fakeClick(app.target.querySelector('#bad-link')));
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(app.target.querySelector('.home').textContent).toBe('home');
    app.unmount();
  });

  it('same-page clicks stay native', async () => {
    const { r, app } = await clickSetup();
    expect(await r.navigate('/about')).toBe(true);
    // Already on /about: re-clicking its link is a no-op for the router.
    expect(click(app.target.querySelector('#about-link'))).toBe(true);
    expect(window.location.pathname).toBe('/about');
    app.unmount();
  });

  it('clicks outside anchors do nothing', async () => {
    const { app } = await clickSetup();
    expect(click(app.target.querySelector('.home'))).toBe(true);
    expect(window.location.pathname).toBe('/');
    app.unmount();
  });

  it('an already-handled click is ignored', async () => {
    const { app } = await clickSetup();
    const seen = [];
    const stop = (e) => {
      e.preventDefault();
      seen.push('first');
    };
    document.addEventListener('click', stop, true);
    try {
      expect(click(app.target.querySelector('#about-link'))).toBe(false);
      expect(seen).toEqual(['first']);
      expect(window.location.pathname).toBe('/');
    } finally {
      document.removeEventListener('click', stop, true);
    }
    app.unmount();
  });
});

describe('router: Link + prefetch + isActive', () => {
  it('prefetch runs loaders but not guards, including query targets', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let loads = 0;
    let guarded = 0;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', null, 'home') },
        {
          path: '/heavy',
          loader: ({ to, params }) => {
            loads += 1;
            expect(to).toBe('/heavy');
            expect(params).toEqual({});
          },
          component: () => h('p', null, 'heavy'),
          guard: () => {
            guarded += 1;
            return true;
          },
        },
      ],
    };
    const r = router.createRouter({
      routes,
      guard: () => {
        guarded += 1;
        return true;
      },
    });
    const app = mountApp(rt, router, r);
    await settle();
    expect(guarded).toBe(1); // boot ran the global guard for '/'
    r.prefetch('/heavy?page=2'); // B4: query string must still match
    await settle();
    expect(loads).toBe(1);
    expect(guarded).toBe(1); // prefetch touched neither the global nor the route guard
    app.unmount();
  });

  it('Link prefetches on pointer enter, focus, and pointer down', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let loads = 0;
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
        {
          path: '/heavy',
          loader: () => {
            loads += 1;
          },
          component: () => h('p', { class: 'heavy' }, 'heavy'),
        },
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
    expect(loads).toBe(3);
    app.unmount();
  });

  it('dedupes overlapping prefetch runs, then re-runs after they finish', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    let loads = 0;
    let release;
    const gate = new Promise((res) => (release = res));
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', null, 'home') },
        {
          path: '/heavy',
          loader: () => {
            loads += 1;
            return gate;
          },
          component: () => h('p', null, 'heavy'),
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    r.prefetch('/heavy');
    r.prefetch('/heavy'); // overlapping burst (hover + pointerdown): deduped
    await settle();
    expect(loads).toBe(1);
    release();
    await settle();
    r.prefetch('/heavy'); // a finished run does not suppress a later one
    await settle();
    expect(loads).toBe(2);
    app.unmount();
  });

  it('isActive matches exactly, by prefix, and ignores trailing slashes', async () => {
    const { rt, router } = await setup('http://localhost/users/42');
    const { h } = rt;
    const r = router.createRouter({
      routes: {
        path: '/',
        component: () => h('div', null, h(router.Outlet, null)),
        children: [
          { path: '/', component: () => h('p', null, 'home') },
          {
            path: '/users',
            component: () => h('div', null, h(router.Outlet, null)),
            children: [{ path: '/:id', component: () => h('p', null, 'u') }],
          },
        ],
      },
    });
    const app = mountApp(rt, router, r);
    await settle();
    expect(r.isActive('/users')).toBe(true);
    expect(r.isActive('/users/42')).toBe(true);
    expect(r.isActive('/users/42/')).toBe(true);
    expect(r.isActive('/')).toBe(false);
    expect(r.isActive('/about')).toBe(false);
    expect(await r.navigate('/')).toBe(true);
    expect(r.isActive('/')).toBe(true);
    expect(r.isActive('/users')).toBe(false);
    app.unmount();
  });

  it('module-level Outlet and Link delegate to the active router', async () => {
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

describe('router: loaders', () => {
  it('starts loaders during navigation without blocking the render', async () => {
    const { rt, router } = await setup('http://localhost/a');
    const { h, signal } = rt;
    const data = signal(null);
    const seen = [];
    let release;
    const gate = new Promise((res) => (release = res));
    const PageB = () => h('p', { class: 'b' }, () => data.value ?? 'loading');
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/a', component: () => h('p', { class: 'a' }, 'a') },
        {
          path: '/b',
          component: PageB,
          loader: ({ to, from, params }) => {
            seen.push([to, from, params]);
            return gate.then(() => (data.value = 'ready'));
          },
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();

    expect(await r.navigate('/b')).toBe(true); // does NOT wait for the loader
    await settle();
    expect(app.target.querySelector('.b').textContent).toBe('loading');
    release();
    await settle();
    expect(app.target.querySelector('.b').textContent).toBe('ready'); // store-driven
    expect(seen).toEqual([['/b', '/a', {}]]);
    app.unmount();
  });

  it('a rejecting loader does not fail the navigation', async () => {
    const { rt, router } = await setup('http://localhost/');
    const { h } = rt;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        { path: '/', component: () => h('p', { class: 'home' }, 'home') },
        {
          path: '/boom',
          component: () => h('p', { class: 'boom' }, 'boom'),
          loader: () => Promise.reject(new Error('no data')),
        },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(await r.navigate('/boom')).toBe(true);
    await settle(); // the swallowed rejection must stay swallowed
    expect(window.location.pathname).toBe('/boom');
    expect(app.target.querySelector('.boom')).not.toBeNull();
    app.unmount();
  });

  it('loaders re-run on traversal like guards', async () => {
    const { rt, router } = await setup('http://localhost/a');
    const { h } = rt;
    let loads = 0;
    const routes = {
      path: '/',
      component: () => h('div', null, h(router.Outlet, null)),
      children: [
        {
          path: '/a',
          component: () => h('p', { class: 'a' }, 'a'),
          loader: () => {
            loads += 1;
          },
        },
        { path: '/b', component: () => h('p', { class: 'b' }, 'b') },
      ],
    };
    const r = router.createRouter({ routes });
    const app = mountApp(rt, router, r);
    await settle();
    expect(loads).toBe(1); // boot
    expect(await r.navigate('/b')).toBe(true);
    await settle();
    expect(loads).toBe(1); // /b has no loader
    history.back();
    await settle();
    expect(app.target.querySelector('.a').textContent).toBe('a');
    expect(loads).toBe(2); // traversal re-ran the target's loader
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

describe('router: scroll restoration', () => {
  it('push scrolls to top and traversal restores the offset in one jump', async () => {
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

    // A controllable scroll environment: scrollY is a mutable value and
    // scrollTo records calls. No rAF mock is needed — a restore is one
    // `queueMicrotask`, so `settle()` (setTimeout) has already flushed it.
    // The fake scrollTo does not move `scrollY`, so set it by hand where the
    // test needs a specific starting offset.
    let scrollY = 0;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      get: () => scrollY,
    });
    const origScrollTo = window.scrollTo;
    const calls = [];
    window.scrollTo = (x, y) => calls.push([x, y]);

    try {
      // Leave /a while scrolled down: the offset is remembered, push goes top.
      scrollY = 100;
      await r.navigate('/b');
      expect(app.target.querySelector('.b').textContent).toBe('b');
      expect(calls.at(-1)).toEqual([0, 0]);

      // Back to /a restores in one jump; the scroll microtask has run by the
      // time settle() resolves.
      scrollY = 0;
      history.back();
      await settle();
      expect(app.target.querySelector('.a').textContent).toBe('a');
      expect(calls.at(-1)).toEqual([0, 100]);
      expect(calls.length).toBe(2); // one jump, no chase

      // Forward to /b: its remembered offset was 0 (left at top).
      scrollY = 0;
      history.forward();
      await settle();
      expect(app.target.querySelector('.b').textContent).toBe('b');
      expect(calls.at(-1)).toEqual([0, 0]);
      expect(calls.length).toBe(3);
    } finally {
      delete window.scrollY;
      window.scrollTo = origScrollTo;
      app.unmount();
    }
  });
});

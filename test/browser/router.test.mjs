import { describe, it, expect, afterAll } from 'bun:test';
import { createServer } from 'node:http';
import plugin from '../../plugin/bun.js';

// Real-browser router coverage via the built-in Bun.WebView (WebKit on macOS,
// an installed Chrome elsewhere) instead of Playwright/Puppeteer. Opt-in:
//
//   bun run test:browser
//
// The happy-dom suite (test/router.test.mjs) covers the router against the
// real History API in a simulated DOM; these tests cover the real bundled
// output in a real browser: boot from a real URL, native Link clicks,
// programmatic navigate(), history push/replace, back/forward traversal,
// real scrolling and prefetch — including guard redirect/block through real
// navigations, which is exactly what failed on Safari under the old
// Navigation API design.
//
// Served over HTTP (node:http with an SPA fallback), not file://: on file://
// `location.pathname` is the filesystem path, so no route matches and
// pushState-based navigation has nothing sensible to resolve against.
const enabled = Bun.env.BUN_BSIG_BROWSER === '1';

function webViewAvailable() {
  if (!enabled) return false;
  try {
    const v = new Bun.WebView();
    v.close();
    return true;
  } catch {
    return false;
  }
}

const available = webViewAvailable();
const dir = import.meta.dir;
let seq = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Bundle a TSX fixture exactly as an app would.
async function buildJS(source) {
  const entry = `${dir}/__router_fixture_${process.pid}_${seq++}.tsx`;
  await Bun.write(entry, source);
  try {
    const out = await Bun.build({
      entrypoints: [entry],
      plugins: [plugin],
      target: 'browser',
      format: 'iife',
    });
    if (!out.success) {
      throw new Error(out.logs.map((l) => l.message ?? String(l)).join('\n'));
    }
    return await out.outputs[0].text();
  } finally {
    await Bun.file(entry).delete();
  }
}

// Serve bundled output for every path (SPA fallback). Returns the base URL
// and a stop function.
//
// NOTE: node:http, not Bun.serve — under `bun test` the happy-dom preload
// replaces the global Response, which Bun.serve rejects.
async function serveApp(source) {
  const js = await buildJS(source);
  const html =
    `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script>${js}</script></body></html>`;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function openPage(base, path) {
  const view = new Bun.WebView();
  await view.navigate(base + path);
  return view;
}

// Poll `expr` inside the page until it returns truthy; returns the value.
async function waitFor(view, expr, timeout = 10000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    try {
      last = await view.evaluate(`(${expr})`);
    } catch {
      last = null;
    }
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${expr}; last=${JSON.stringify(last)}`);
}

const selText = (sel) =>
  `(function () { var el = document.querySelector(${JSON.stringify(sel)}); return el ? el.textContent : null; })()`;

async function waitText(view, selector, timeout) {
  return waitFor(view, selText(selector), timeout);
}

async function text(view, selector) {
  return view.evaluate(selText(selector));
}

// --- fixtures ---------------------------------------------------------------

const BASIC = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet, Link } from '../../router.js';
const Home = () => <p class="home">home</p>;
const About = () => <p class="about">about</p>;
const Layout = () => <div class="layout"><nav><Link to="/" id="link-home">home</Link><Link to="/about" id="link-about">about</Link></nav><Outlet /></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/', component: Home },
  { path: '/about', component: About },
]}});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const NESTED = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet, Link, matchTree } from '../../router.js';
const Home = () => <p class="home">home</p>;
const Users = () => <div class="users"><p class="users-title">users</p><Outlet /></div>;
const User = (props) => <p class="user">{"User " + props.params.id}</p>;
const Layout = () => <div class="layout"><nav><Link to="/" id="link-home">home</Link><Link to="/users/42" id="link-user">user42</Link></nav><Outlet /></div>;
const routes = { path: '/', component: Layout, children: [
  { path: '/', component: Home },
  { path: '/users', component: Users, children: [{ path: '/:id', component: User }] },
]};
const router = createRouter({ routes: routes });
window.__router = router;
window.__matchTree = matchTree;
window.__matchDemo = function (p) {
  var m = matchTree(routes.children, p, routes.path);
  return m ? m.map(function (e) { return e.path + ':' + JSON.stringify(e.params); }).join('|') : null;
};
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const NOTFOUND = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet } from '../../router.js';
const Home = () => <p class="home">home</p>;
const Missing = () => <p class="nf">404</p>;
const Layout = () => <div class="layout"><Outlet /></div>;
const router = createRouter({
  routes: { path: '/', component: Layout, children: [{ path: '/', component: Home }] },
  notFound: { path: '', component: Missing },
});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const GUARD_BOOT_STRING = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet } from '../../router.js';
const Admin = () => <p class="admin">admin</p>;
const Login = () => <p class="login">login</p>;
const Layout = () => <div class="layout"><Outlet /></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/admin', component: Admin, beforeEnter: function () { return '/login'; } },
  { path: '/login', component: Login },
]}});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const GUARD_BOOT_OBJECT = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet } from '../../router.js';
const Admin = () => <p class="admin">admin</p>;
const Login = () => <p class="login">login</p>;
const Layout = () => <div class="layout"><Outlet /></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/admin', component: Admin, beforeEnter: function () { return { path: '/login', replace: true }; } },
  { path: '/login', component: Login },
]}});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const GUARDS = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet, Link } from '../../router.js';
const Home = () => <p class="home">home</p>;
const Admin = () => <p class="admin">admin</p>;
const Secret = () => <p class="secret">secret</p>;
const Login = () => <p class="login">login</p>;
const Layout = () => <div class="layout"><nav><Link to="/" id="link-home">home</Link><Link to="/secret" id="link-secret">secret</Link></nav><Outlet /></div>;
window.__allowAdmin = true;
window.__blockHome = false;
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/', component: Home, beforeEnter: function () { return window.__blockHome ? false : true; } },
  { path: '/admin', component: Admin, beforeEnter: function () { return window.__allowAdmin ? true : '/login'; } },
  { path: '/secret', component: Secret, beforeEnter: function () { return false; } },
  { path: '/login', component: Login },
]}});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const HEAVY = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet, Link } from '../../router.js';
const Home = () => <p class="home">home</p>;
const Heavy = () => <p class="loaded">heavy-loaded</p>;
Heavy.preload = function () { window.__loaderRan = true; };
window.__loaderRan = false;
window.__guardCalls = [];
const Layout = () => <div class="layout"><nav><Link to="/" id="link-home">home</Link><Link to="/heavy" id="link-heavy">heavy</Link></nav><Outlet /></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/', component: Home },
  { path: '/heavy', component: Heavy, beforeEnter: function () { window.__guardCalls.push('heavy'); return true; } },
]}});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const LIFECYCLE = `
import mount, { onUnmount } from '../../runtime.js';
import { createRouter, Router, Outlet } from '../../router.js';
window.__events = [];
const PageA = () => { onUnmount(function () { window.__events.push('A'); }); return <p class="a">a</p>; };
const PageB = () => { onUnmount(function () { window.__events.push('B'); }); return <p class="b">b</p>; };
const Layout = () => { onUnmount(function () { window.__events.push('layout'); }); return <div class="layout"><Outlet /></div>; };
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/a', component: PageA },
  { path: '/b', component: PageB },
]}});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const ROUTES_PROP = `
import mount from '../../runtime.js';
import { Router, Outlet, Link } from '../../router.js';
const Home = () => <p class="home">home</p>;
const About = () => <p class="about">about</p>;
const Layout = () => <div class="layout"><nav><Link to="/" id="link-home">home</Link><Link to="/about" id="link-about">about</Link></nav><Outlet /></div>;
const routes = { path: '/', component: Layout, children: [
  { path: '/', component: Home },
  { path: '/about', component: About },
]};
mount(document.getElementById('app'), () => <Router routes={routes} />);
`;

const TALL = `
import mount from '../../runtime.js';
import { createRouter, Router, Outlet, Link } from '../../router.js';
const Home = () => <div><p class="home">home</p><div style="height:3000px">spacer</div></div>;
const About = () => <div><p class="about">about</p><div style="height:3000px">spacer</div></div>;
const Layout = () => <div class="layout"><nav><Link to="/" id="link-home">home</Link><Link to="/about" id="link-about">about</Link></nav><Outlet /></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/', component: Home },
  { path: '/about', component: About },
]}});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

const KITCHEN = `
import mount, { onUnmount } from '../../runtime.js';
import { createRouter, Router, Outlet, Link } from '../../router.js';
window.__events = [];
const Home = () => <p class="home">home</p>;
const Users = () => <div class="users"><p class="users-title">users</p><Outlet /></div>;
const User = (props) => <p class="user">{"User " + props.params.id}</p>;
const Heavy = () => { onUnmount(function () { window.__events.push('heavy'); }); return <p class="loaded">heavy-loaded</p>; };
const Admin = () => <p class="admin">admin</p>;
const Login = () => <p class="login">login</p>;
const Missing = () => <p class="nf">404</p>;
const Layout = () => <div class="layout"><nav><Link to="/" id="nav-home">home</Link><Link to="/users/7" id="nav-user">user</Link><Link to="/heavy" id="nav-heavy">heavy</Link><Link to="/admin" id="nav-admin">admin</Link></nav><Outlet /></div>;
const router = createRouter({
  routes: { path: '/', component: Layout, children: [
    { path: '/', component: Home },
    { path: '/users', component: Users, children: [{ path: '/:id', component: User }] },
    { path: '/heavy', component: Heavy },
    { path: '/admin', component: Admin, beforeEnter: function () { return '/login'; } },
    { path: '/login', component: Login },
  ]},
  notFound: { path: '', component: Missing },
});
window.__router = router;
mount(document.getElementById('app'), () => <Router router={router} />);
`;

// --- tests ------------------------------------------------------------------

describe.skipIf(!available)('router in a real browser', () => {
  it('boots and renders the matched route through the layout outlet', async () => {
    const { base, stop } = await serveApp(BASIC);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      expect(await text(view, '.layout nav')).toContain('home');
      expect(await view.evaluate(`window.__router.pathname.value`)).toBe('/');
    } finally {
      view.close();
      await stop();
    }
  });

  it('renders nested routes with params from a real URL', async () => {
    const { base, stop } = await serveApp(NESTED);
    const view = await openPage(base, '/users/42');
    try {
      expect(await waitText(view, '.users-title')).toBe('users');
      expect(await waitText(view, '.user')).toBe('User 42');
      expect(await view.evaluate(`window.__router.pathname.value`)).toBe('/users/42');
    } finally {
      view.close();
      await stop();
    }
  });

  it('renders notFound for an unknown path', async () => {
    const { base, stop } = await serveApp(NOTFOUND);
    const view = await openPage(base, '/missing');
    try {
      expect(await waitText(view, '.nf')).toBe('404');
      expect(await view.evaluate(`window.__router.pathname.value`)).toBe('/missing');
    } finally {
      view.close();
      await stop();
    }
  });

  it('renders an empty outlet when nothing matches and there is no notFound', async () => {
    const { base, stop } = await serveApp(BASIC);
    const view = await openPage(base, '/missing');
    try {
      await waitFor(view, `document.querySelector('.layout')`);
      expect(await text(view, '.home')).toBeNull();
      expect(await text(view, '.about')).toBeNull();
      expect(await view.evaluate(`window.__router.pathname.value`)).toBe('/missing');
    } finally {
      view.close();
      await stop();
    }
  });

  it('a native Link click navigates client-side without reloading', async () => {
    const { base, stop } = await serveApp(BASIC);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`document.getElementById('link-home').getAttribute('aria-current')`)).toBe('page');
      // Mark the layout: a full reload would drop the mark.
      await view.evaluate(`document.querySelector('.layout').dataset.mark = 'kept'`);
      await view.click('#link-about');
      expect(await waitText(view, '.about')).toBe('about');
      expect(await view.evaluate(`location.pathname`)).toBe('/about');
      expect(await view.evaluate(`document.querySelector('.layout').dataset.mark`)).toBe('kept');
      expect(await view.evaluate(`document.getElementById('link-about').getAttribute('aria-current')`)).toBe('page');
      expect(await view.evaluate(`document.getElementById('link-home').getAttribute('aria-current')`)).toBe('false');
    } finally {
      view.close();
      await stop();
    }
  });

  it('navigate() swaps the page and updates the URL and pathname signal', async () => {
    const { base, stop } = await serveApp(BASIC);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`window.__router.navigate('/about')`)).toBe(true);
      expect(await waitText(view, '.about')).toBe('about');
      expect(await view.evaluate(`location.pathname`)).toBe('/about');
      expect(await view.evaluate(`window.__router.pathname.value`)).toBe('/about');
    } finally {
      view.close();
      await stop();
    }
  });

  it('replace navigates without growing history while push does', async () => {
    const { base, stop } = await serveApp(BASIC);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      const before = await view.evaluate(`history.length`);
      expect(await view.evaluate(`window.__router.navigate('/about', { replace: true })`)).toBe(true);
      expect(await waitText(view, '.about')).toBe('about');
      expect(await view.evaluate(`history.length`)).toBe(before);
      expect(await view.evaluate(`window.__router.navigate('/')`)).toBe(true);
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`history.length`)).toBe(before + 1);
    } finally {
      view.close();
      await stop();
    }
  });

  it('back() traverses to the previous page', async () => {
    const { base, stop } = await serveApp(BASIC);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`window.__router.navigate('/about')`)).toBe(true);
      expect(await waitText(view, '.about')).toBe('about');
      await view.evaluate(`history.back()`);
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`location.pathname`)).toBe('/');
      expect(await view.evaluate(`window.__router.pathname.value`)).toBe('/');
    } finally {
      view.close();
      await stop();
    }
  });

  it('isActive() matches exactly, by prefix, and ignores trailing slashes', async () => {
    const { base, stop } = await serveApp(NESTED);
    const view = await openPage(base, '/users/42');
    try {
      expect(await waitText(view, '.user')).toBe('User 42');
      const active = (to) => view.evaluate(`window.__router.isActive(${JSON.stringify(to)})`);
      expect(await active('/users')).toBe(true); // prefix of /users/42
      expect(await active('/users/42')).toBe(true);
      expect(await active('/users/42/')).toBe(true); // trailing slash ignored
      expect(await active('/')).toBe(false); // root only matches root
      expect(await active('/about')).toBe(false);
      expect(await view.evaluate(`window.__router.navigate('/')`)).toBe(true);
      expect(await waitText(view, '.home')).toBe('home');
      expect(await active('/')).toBe(true);
      expect(await active('/users')).toBe(false);
    } finally {
      view.close();
      await stop();
    }
  });

  it('a boot-time string guard redirect rewrites the address bar', async () => {
    const { base, stop } = await serveApp(GUARD_BOOT_STRING);
    const view = await openPage(base, '/admin');
    try {
      expect(await waitText(view, '.login')).toBe('login');
      expect(await view.evaluate(`location.pathname`)).toBe('/login');
    } finally {
      view.close();
      await stop();
    }
  });

  it('a boot-time object guard redirect rewrites the address bar', async () => {
    const { base, stop } = await serveApp(GUARD_BOOT_OBJECT);
    const view = await openPage(base, '/admin');
    try {
      expect(await waitText(view, '.login')).toBe('login');
      expect(await view.evaluate(`location.pathname`)).toBe('/login');
    } finally {
      view.close();
      await stop();
    }
  });

  it('a guard redirect rewrites the target through a real navigation', async () => {
    const { base, stop } = await serveApp(GUARDS);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      await view.evaluate(`window.__allowAdmin = false`);
      expect(await view.evaluate(`window.__router.navigate('/admin')`)).toBe(true);
      expect(await waitText(view, '.login')).toBe('login');
      expect(await view.evaluate(`location.pathname`)).toBe('/login');
    } finally {
      view.close();
      await stop();
    }
  });

  it('a blocked navigation stays put through a real click and navigate()', async () => {
    const { base, stop } = await serveApp(GUARDS);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      // Native click on the guarded link: no reload, no movement.
      await view.evaluate(`document.querySelector('.layout').dataset.mark = 'kept'`);
      await view.click('#link-secret');
      await sleep(600);
      expect(await text(view, '.home')).toBe('home');
      expect(await text(view, '.secret')).toBeNull();
      expect(await view.evaluate(`location.pathname`)).toBe('/');
      expect(await view.evaluate(`document.querySelector('.layout').dataset.mark`)).toBe('kept');
      // Programmatic navigation reports the block.
      expect(await view.evaluate(`window.__router.navigate('/secret')`)).toBe(false);
      expect(await text(view, '.home')).toBe('home');
      expect(await view.evaluate(`location.pathname`)).toBe('/');
    } finally {
      view.close();
      await stop();
    }
  });

  it('a blocked back-navigation pins the URL to the page on screen', async () => {
    const { base, stop } = await serveApp(GUARDS);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`window.__router.navigate('/admin')`)).toBe(true);
      expect(await waitText(view, '.admin')).toBe('admin');
      // Going back is now refused: the address bar is pinned back to /admin.
      await view.evaluate(`window.__blockHome = true`);
      await view.evaluate(`history.back()`);
      await sleep(800);
      expect(await text(view, '.admin')).toBe('admin');
      expect(await view.evaluate(`location.pathname`)).toBe('/admin');
    } finally {
      view.close();
      await stop();
    }
  });

  it('prefetch() warms a component\'s preload hook', async () => {
    const { base, stop } = await serveApp(HEAVY);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      await view.evaluate(`window.__router.prefetch('/heavy')`);
      expect(await waitFor(view, `window.__loaderRan`)).toBe(true);
      expect(await view.evaluate(`JSON.stringify(window.__guardCalls)`)).toBe('["heavy"]');
    } finally {
      view.close();
      await stop();
    }
  });

  it('hovering a Link prefetches its route', async () => {
    const { base, stop } = await serveApp(HEAVY);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      await view.evaluate(`document.getElementById('link-heavy').dispatchEvent(new Event('mouseenter'))`);
      expect(await waitFor(view, `window.__loaderRan`)).toBe(true);
    } finally {
      view.close();
      await stop();
    }
  });

  it('leaving a page runs its onUnmount and stops its scope', async () => {
    const { base, stop } = await serveApp(LIFECYCLE);
    const view = await openPage(base, '/a');
    try {
      expect(await waitText(view, '.a')).toBe('a');
      expect(await view.evaluate(`window.__router.navigate('/b')`)).toBe(true);
      expect(await waitText(view, '.b')).toBe('b');
      expect(await view.evaluate(`JSON.stringify(window.__events)`)).toBe('["A"]');
    } finally {
      view.close();
      await stop();
    }
  });

  it('matchTree() resolves chains and params in the real engine', async () => {
    const { base, stop } = await serveApp(NESTED);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`window.__matchDemo('/users/42')`)).toBe(
        '/users:{}|/users/:id:{"id":"42"}',
      );
      expect(await view.evaluate(`window.__matchDemo('/users')`)).toBe('/users:{}');
      expect(await view.evaluate(`window.__matchDemo('/nope')`)).toBeNull();
    } finally {
      view.close();
      await stop();
    }
  });

  it('<Router routes={...}/> boots and navigates without an instance', async () => {
    const { base, stop } = await serveApp(ROUTES_PROP);
    const view = await openPage(base, '/about');
    try {
      expect(await waitText(view, '.about')).toBe('about');
      await view.click('#link-home');
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`location.pathname`)).toBe('/');
    } finally {
      view.close();
      await stop();
    }
  });

  it('a push navigation scrolls back to the top', async () => {
    const { base, stop } = await serveApp(TALL);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      await view.evaluate(`window.scrollTo(0, 500)`);
      await waitFor(view, `window.scrollY > 400`);
      // Programmatic (not a native click): the link is scrolled out of view.
      expect(await view.evaluate(`window.__router.navigate('/about')`)).toBe(true);
      expect(await waitText(view, '.about')).toBe('about');
      expect(await view.evaluate(`window.scrollY`)).toBe(0);
    } finally {
      view.close();
      await stop();
    }
  });

  it('back() restores the scroll offset of the previous page in one jump', async () => {
    const { base, stop } = await serveApp(TALL);
    const view = await openPage(base, '/');
    try {
      expect(await waitText(view, '.home')).toBe('home');
      // Leave / scrolled down; the push to /about must go to the top.
      await view.evaluate(`window.scrollTo(0, 800)`);
      await waitFor(view, `window.scrollY > 700`);
      expect(await view.evaluate(`window.__router.navigate('/about')`)).toBe(true);
      expect(await waitText(view, '.about')).toBe('about');
      expect(await view.evaluate(`window.scrollY`)).toBe(0);
      await view.evaluate(`window.scrollTo(0, 500)`);
      await waitFor(view, `window.scrollY > 400`);
      await view.evaluate(`history.back()`);
      expect(await waitText(view, '.home')).toBe('home');
      // One jump restores the offset we left / at.
      expect(await waitFor(view, `window.scrollY > 700`)).toBe(true);
    } finally {
      view.close();
      await stop();
    }
  });

  it('kitchensink: nested params, guards, links, and notFound together', async () => {
    const { base, stop } = await serveApp(KITCHEN);
    const view = await openPage(base, '/');
    try {
      // Boot: home with active nav state.
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`document.getElementById('nav-home').getAttribute('aria-current')`)).toBe('page');

      // Nested params through a native click.
      await view.click('#nav-user');
      expect(await waitText(view, '.user')).toBe('User 7');
      expect(await view.evaluate(`window.__router.isActive('/users')`)).toBe(true);
      expect(await view.evaluate(`window.__router.pathname.value`)).toBe('/users/7');

      // Heavy page: plain component, still unmounted on leave.
      await view.evaluate(`document.getElementById('nav-heavy').scrollIntoView()`);
      await view.click('#nav-heavy');
      expect(await waitText(view, '.loaded')).toBe('heavy-loaded');

      // Leaving the heavy page unmounts it.
      await view.evaluate(`window.__router.navigate('/')`);
      expect(await waitText(view, '.home')).toBe('home');
      expect(await view.evaluate(`JSON.stringify(window.__events)`)).toBe('["heavy"]');

      // Guarded boot: a fresh load of /admin lands on /login.
      await view.navigate(base + '/admin');
      expect(await waitText(view, '.login')).toBe('login');
      expect(await view.evaluate(`location.pathname`)).toBe('/login');

      // Unknown path: the notFound page.
      await view.navigate(base + '/nope');
      expect(await waitText(view, '.nf')).toBe('404');

      // And back home programmatically from 404.
      expect(await view.evaluate(`window.__router.navigate('/')`)).toBe(true);
      expect(await waitText(view, '.home')).toBe('home');
    } finally {
      view.close();
      await stop();
    }
  });
});

afterAll(async () => {
  // buildJS deletes its temp entry after bundling, so there should be nothing
  // left; sweep anyway in case a build threw mid-flight.
  const { Glob } = Bun;
  const glob = new Glob('__router_fixture_*');
  for await (const file of glob.scan(dir)) {
    await Bun.file(`${dir}/${file}`).delete().catch(() => {});
  }
});

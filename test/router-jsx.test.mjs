import { describe, it, expect, afterEach } from 'bun:test';
import { bundle, settle, useHistory } from './helpers.ts';

// End-to-end through the real JSX transform the bundler uses, against the real
// router. The router's own unit tests pass props to `h()` directly, so they
// never exercise the plugin's auto-thunking; these do. They reproduce the three
// consumer-reported failures: thunked `<Router>` config props, a fragment layout
// root, and `<Router>` mounted conditionally through `<Show>`.
const plugin = (await import('../plugin/bsig-jsx.js')).default();

// Fixtures push their mount's unmount here; flushed below so a router never
// leaks its document/popstate listeners into the next test (or file).
afterEach(() => {
  const teardowns = window.__unmounts ?? [];
  window.__unmounts = [];
  for (const teardown of teardowns) {
    try {
      teardown();
    } catch {}
  }
});

let counter = 0;
async function run(src, url) {
  useHistory(url);
  document.body.innerHTML = '<div id="app"></div>';
  const out = await plugin.transform(src, `${import.meta.dir}/__router_jsx_${counter++}.tsx`);
  const code = await bundle(
    out.code
      .replaceAll('from "bsig/router"', 'from "../router.js"')
      .replaceAll('from "bsig"', 'from "../runtime.js"'),
    { loader: 'jsx', format: 'iife' },
  );
  (0, eval)(code);
  await settle(5);
  return {
    app: document.getElementById('app'),
    async navigate(to) {
      await window.__router.navigate(to);
      await settle(5);
    },
  };
}

describe('router through the real JSX plugin', () => {
  it('<Router routes={routes} /> (documented) boots and renders', async () => {
    const { app } = await run(
      `
import mount from 'bsig';
import { Router, Outlet } from 'bsig/router';
const About = () => <p class="page">About</p>;
const Layout = () => <div class="layout"><Outlet/></div>;
const routes = { path: '/', component: Layout, children: [{ path: '/about', component: About }] };
(window.__unmounts ??= []).push(mount(document.getElementById('app'), () => <Router routes={routes} />));
`,
      'http://localhost/about',
    );
    expect(app.querySelector('.page').textContent).toBe('About');
  });

  it('<Router router={instance} /> (documented) boots and renders', async () => {
    const { app } = await run(
      `
import mount from 'bsig';
import { createRouter, Router, Outlet } from 'bsig/router';
const About = () => <p class="page">About</p>;
const Layout = () => <div class="layout"><Outlet/></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [{ path: '/about', component: About }] } });
(window.__unmounts ??= []).push(mount(document.getElementById('app'), () => <Router router={router} />));
`,
      'http://localhost/about',
    );
    expect(app.querySelector('.page').textContent).toBe('About');
  });

  it('unwraps a thunked beforeEnter guard (boot redirect)', async () => {
    const { app } = await run(
      `
import mount from 'bsig';
import { Router, Outlet } from 'bsig/router';
const guard = ({ to }) => (to === '/admin' ? '/login' : true);
const Admin = () => <p class="admin">admin</p>;
const Login = () => <p class="login">login</p>;
const Layout = () => <div class="layout"><Outlet/></div>;
const routes = { path: '/', component: Layout, children: [
  { path: '/admin', component: Admin },
  { path: '/login', component: Login },
] };
(window.__unmounts ??= []).push(mount(document.getElementById('app'), () => <Router routes={routes} beforeEnter={guard} />));
`,
      'http://localhost/admin',
    );
    expect(app.querySelector('.login').textContent).toBe('login');
    expect(window.location.pathname).toBe('/login');
  });

  it('renders through a fragment layout root with a fragment page', async () => {
    const { app } = await run(
      `
import mount from 'bsig';
import { Router, Outlet } from 'bsig/router';
const About = () => <><p class="page">About</p></>;
const Layout = () => <><nav>nav</nav><Outlet/></>;
const routes = { path: '/', component: Layout, children: [{ path: '/about', component: About }] };
(window.__unmounts ??= []).push(mount(document.getElementById('app'), () => <Router routes={routes} />));
`,
      'http://localhost/about',
    );
    expect(app.querySelector('nav')).toBeTruthy(); // layout fragment nav rendered
    expect(app.querySelector('.page').textContent).toBe('About');
    expect(app.textContent).not.toContain('=>'); // no thunk source leaked as text
  });

  it('<Router> inside <Show> keeps updating after an off/on cycle', async () => {
    const { app, navigate } = await run(
      `
import mount, { signal, Show } from 'bsig';
import { createRouter, Router, Outlet } from 'bsig/router';
const show = signal(true);
const A = () => <p class="a">A</p>;
const B = () => <p class="b">B</p>;
const Layout = () => <div class="layout"><Outlet/></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [
  { path: '/a', component: A },
  { path: '/b', component: B },
] } });
window.__router = router;
window.__show = show;
(window.__unmounts ??= []).push(mount(document.getElementById('app'), () => <Show when={show.value}><Router router={router} /></Show>));
`,
      'http://localhost/a',
    );
    // Hide, then show again: the router node is rebuilt, so a later navigation
    // must still patch the DOM.
    window.__show.value = false;
    await settle(5);
    window.__show.value = true;
    await settle(5);
    expect(app.querySelector('.a').textContent).toBe('A');
    await navigate('/b');
    expect(app.querySelector('.b').textContent).toBe('B');
  });
});

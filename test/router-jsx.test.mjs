import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

// End-to-end through the real JSX transform the bundler uses, against the real
// router. The router's own unit tests pass props to `h()` directly, so they
// never exercise the plugin's auto-thunking; these do. They reproduce the three
// consumer-reported failures: thunked `<Router>` config props, a fragment layout
// root, and `<Router>` mounted conditionally through `<Show>`.
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));
const esbuild = require('esbuild');
const plugin = (await import('../plugin/bsig-jsx.js')).default();

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};

// Minimal Navigation API mock: dispatches `navigate`, resolves committed, and
// runs the intercepted precommit/handler like a real push.
function makeNavigation(win) {
  const listeners = new Set();
  let seq = 0;
  return {
    currentEntry: { key: 'entry-0' },
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
              redirect(p) {
                win.history.replaceState(null, '', p);
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

function setupDom(url) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app"></div></body></html>',
    { pretendToBeVisual: true, url },
  );
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLUnknownElement = dom.window.HTMLUnknownElement;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
    dom.window,
  );
  globalThis.history = dom.window.history;
  globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
  globalThis.removeEventListener = dom.window.removeEventListener.bind(
    dom.window,
  );
  dom.window.scrollTo = () => {};
  dom.window.navigation = makeNavigation(dom.window);
  return dom;
}

let counter = 0;
async function run(src, url) {
  const dom = setupDom(url);
  const file = path.join(here, `__router_jsx_${counter++}.tsx`);
  const out = await plugin.transform(src, file);
  const bundled = path.join(here, `__router_jsx_${counter++}.mjs`);
  fs.writeFileSync(
    bundled,
    out.code
      .replaceAll(`from "bsig/router"`, `from "${here}/../router.js"`)
      .replaceAll(`from "bsig"`, `from "${here}/../runtime.js"`),
  );
  const code = esbuild.buildSync({
    entryPoints: [bundled],
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  fs.rmSync(bundled);
  (0, eval)(code);
  await settle();
  return {
    dom,
    app: dom.window.document.getElementById('app'),
    async navigate(to) {
      await window.__router.navigate(to);
      await settle();
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
mount(document.getElementById('app'), () => <Router routes={routes} />);
`,
      'http://localhost/about',
    );
    assert.equal(app.querySelector('.page').textContent, 'About');
  });

  it('<Router router={instance} /> (documented) boots and renders', async () => {
    const { app } = await run(
      `
import mount from 'bsig';
import { createRouter, Router, Outlet } from 'bsig/router';
const About = () => <p class="page">About</p>;
const Layout = () => <div class="layout"><Outlet/></div>;
const router = createRouter({ routes: { path: '/', component: Layout, children: [{ path: '/about', component: About }] } });
mount(document.getElementById('app'), () => <Router router={router} />);
`,
      'http://localhost/about',
    );
    assert.equal(app.querySelector('.page').textContent, 'About');
  });

  it('unwraps a thunked beforeEnter guard (boot redirect)', async () => {
    const { app, dom } = await run(
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
mount(document.getElementById('app'), () => <Router routes={routes} beforeEnter={guard} />);
`,
      'http://localhost/admin',
    );
    assert.equal(app.querySelector('.login').textContent, 'login');
    assert.equal(dom.window.location.pathname, '/login');
  });

  it('renders through a fragment layout root with a fragment page', async () => {
    const { app } = await run(
      `
import mount from 'bsig';
import { Router, Outlet } from 'bsig/router';
const About = () => <><p class="page">About</p></>;
const Layout = () => <><nav>nav</nav><Outlet/></>;
const routes = { path: '/', component: Layout, children: [{ path: '/about', component: About }] };
mount(document.getElementById('app'), () => <Router routes={routes} />);
`,
      'http://localhost/about',
    );
    assert.ok(app.querySelector('nav'), 'layout fragment nav rendered');
    assert.equal(app.querySelector('.page').textContent, 'About');
    assert.ok(!app.textContent.includes('=>'), 'no thunk source leaked as text');
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
mount(document.getElementById('app'), () => <Show when={show.value}><Router router={router} /></Show>);
`,
      'http://localhost/a',
    );
    // Hide, then show again: the router node is rebuilt, so a later navigation
    // must still patch the DOM.
    window.__show.value = false;
    await settle();
    window.__show.value = true;
    await settle();
    assert.equal(app.querySelector('.a').textContent, 'A');
    await navigate('/b');
    assert.equal(app.querySelector('.b').textContent, 'B');
  });
});

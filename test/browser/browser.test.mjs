import { describe, it, expect, afterAll } from 'bun:test';
import plugin from '../../plugin/bun.js';

// Real-browser coverage using the built-in Bun.WebView (WebKit on macOS, an
// installed Chrome elsewhere) instead of Playwright/Puppeteer. It is opt-in
// because the API is experimental and needs a browser:
//
//   bun run test:browser
//
// The suite skips itself when it is not explicitly enabled or no browser can be
// spawned, so the default `bun test` stays fast and green.
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
const entry = `${dir}/__bsig_browser_fixture.tsx`;
const html = `${dir}/__bsig_browser_fixture.html`;

const SOURCE = `
import mount, { h, signal, For } from '../../runtime.js';
const count = signal(0);
const items = signal(['alpha', 'beta', 'gamma']);
function App() {
  return (
    <div>
      <button id="inc" onClick={() => count.value++}>increment</button>
      <button id="add" onClick={() => (items.value = [...items.value, 'delta'])}>add</button>
      <p id="count">Count: {count.value}</p>
      <ul id="list">{For(items, (x) => x, (x) => <li>{x}</li>)}</ul>
    </div>
  );
}
mount(document.getElementById('app'), App);
`;

// Built once, shared by both tests. Bundles the real runtime + plugin exactly
// as an app would, then inlines the result into a file:// page.
let pageUrl = null;
async function buildPage() {
  if (pageUrl) return pageUrl;
  await Bun.write(entry, SOURCE);
  const out = await Bun.build({
    entrypoints: [entry],
    plugins: [plugin],
    target: 'browser',
    format: 'iife',
  });
  if (!out.success) throw new Error(out.logs.map((l) => l.message ?? String(l)).join('\n'));
  const js = await out.outputs[0].text();
  await Bun.write(
    html,
    `<!doctype html><html><body><div id="app"></div><script>${js}</script></body></html>`,
  );
  pageUrl = `file://${html}`;
  return pageUrl;
}

describe.skipIf(!available)('real browser (Bun.WebView)', () => {
  it('boots and patches text on a native click, without rerendering the node', async () => {
    const view = new Bun.WebView({ width: 800, height: 600 });
    try {
      await view.navigate(await buildPage());
      expect(await view.evaluate("document.getElementById('count').textContent")).toBe('Count: 0');
      expect(
        await view.evaluate("[...document.querySelectorAll('#list li')].map((li) => li.textContent)"),
      ).toEqual(['alpha', 'beta', 'gamma']);

      // Mark the list; a fine-grained update must not replace it.
      await view.evaluate("document.getElementById('list').dataset.mark = 'kept'");
      await view.click('#inc');
      await view.click('#inc');
      expect(await view.evaluate("document.getElementById('count').textContent")).toBe('Count: 2');
      expect(await view.evaluate("document.getElementById('list').dataset.mark")).toBe('kept');
      expect(
        await view.evaluate("[...document.querySelectorAll('#list li')].map((li) => li.textContent)"),
      ).toEqual(['alpha', 'beta', 'gamma']);
    } finally {
      view.close();
    }
  });

  it('appends keyed rows through a real click', async () => {
    const view = new Bun.WebView();
    try {
      await view.navigate(await buildPage());
      await view.click('#add');
      expect(
        await view.evaluate("[...document.querySelectorAll('#list li')].map((li) => li.textContent)"),
      ).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    } finally {
      view.close();
    }
  });
});

afterAll(async () => {
  for (const file of [entry, html]) {
    const f = Bun.file(file);
    if (await f.exists()) await f.delete();
  }
});

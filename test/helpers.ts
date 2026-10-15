// Shared helpers for the Bun test suite.
//
// The DOM itself (window/document/Event/…) comes from happy-dom via the
// preload in test/setup.ts; these helpers cover the pieces happy-dom does not
// ship: a Navigation API mock and a small Bun.build-based bundler for the
// transform-chain and tree-shake guards.

// happy-dom's `happyDOM` handle and the Navigation API the router targets are
// not in the standard DOM lib; declare just what the helpers and tests touch.
export type InterceptHandlers = {
  precommitHandler?(controller: { redirect(path: string): void }): void | Promise<void>;
  handler?(): void;
};

export type NavigateEvent = {
  canIntercept: boolean;
  hashChange: boolean;
  downloadRequest: null;
  formData: null;
  navigationType: 'push' | 'traverse' | 'reload';
  destination: { url: string; key: string };
  signal: AbortSignal;
  intercept(handlers: InterceptHandlers): void;
};

export type NavigationMock = {
  currentEntry: { key: string };
  listenerCount(): number;
  addEventListener(type: string, fn: (event: NavigateEvent) => void): void;
  removeEventListener(type: string, fn: (event: NavigateEvent) => void): void;
  navigate(
    url: string,
    opts?: { history?: string },
  ): { committed: Promise<void>; finished: Promise<void> };
};

declare global {
  interface Window {
    happyDOM: { setURL(url: string): void };
    navigation: NavigationMock;
  }
}

export const flush = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
export const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await flush();
};

// Minimal Navigation API mock: dispatches `navigate`, resolves committed, and
// runs the intercepted precommit/handler like a real push.
export function makeNavigation(win: Window): NavigationMock {
  const listeners = new Set<(event: NavigateEvent) => void>();
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
      // Held in an object so the closure's write is visible to control-flow
      // analysis below (a bare `let` is narrowed back to `null`).
      const state: { intercepted: InterceptHandlers | null } = { intercepted: null };
      const ev: NavigateEvent = {
        canIntercept: true,
        hashChange: false,
        downloadRequest: null,
        formData: null,
        navigationType: opts.history === 'traverse' ? 'traverse' : 'push',
        destination: { url: abs.href, key: 'entry-' + ++seq },
        signal: new AbortController().signal,
        intercept(h) {
          state.intercepted = h;
        },
      };
      let resolve_committed!: () => void;
      let reject_committed!: (reason?: unknown) => void;
      let resolve_finished!: () => void;
      const committed = new Promise<void>((res, rej) => {
        resolve_committed = res;
        reject_committed = rej;
      });
      const finished = new Promise<void>((res) => {
        resolve_finished = res;
      });
      (async () => {
        for (const fn of [...listeners]) fn(ev);
        try {
          const handlers = state.intercepted;
          if (handlers?.precommitHandler)
            await handlers.precommitHandler({
              redirect(path) {
                win.history.replaceState(null, '', path);
              },
            });
          win.history.pushState(null, '', abs.pathname + abs.search);
          resolve_committed();
          if (handlers?.handler) handlers.handler();
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

// Point the shared happy-dom window at `url` and install the navigation mock.
export function useNavigation(url = 'http://localhost/') {
  window.happyDOM.setURL(url);
  window.scrollTo = () => {};
  window.navigation = makeNavigation(window);
  return window;
}

let seq = 0;
// `bundle` is still a runtime option (it bundles by default in current Bun) but
// is absent from `Bun.BuildConfig`; make the intent explicit.
type BuildConfig = Bun.BuildConfig & { bundle?: boolean };
// Bundle source with Bun.build. Returns the output text. `loader` maps to the
// temp file extension (js/jsx/ts/tsx) so the bundler picks the right parser.
export async function bundle(
  contents: string,
  {
    loader = 'js',
    format = 'esm',
    resolveDir = import.meta.dir,
  }: {
    loader?: 'js' | 'jsx' | 'ts' | 'tsx';
    format?: 'esm' | 'cjs' | 'iife';
    resolveDir?: string;
  } = {},
): Promise<string> {
  const file = `${resolveDir}/__bsig_bundle_${process.pid}_${seq++}.${loader}`;
  await Bun.write(file, contents);
  try {
    const config: BuildConfig = {
      entrypoints: [file],
      bundle: true,
      format,
      target: 'browser',
    };
    const out = await Bun.build(config);
    if (!out.success) {
      throw new Error(
        'bundle failed:\n' + out.logs.map((l) => l.message ?? String(l)).join('\n'),
      );
    }
    return await out.outputs[0].text();
  } finally {
    await Bun.file(file).delete();
  }
}

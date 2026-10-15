// Shared helpers for the Bun test suite.
//
// The DOM itself (window/document/Event/…) comes from happy-dom via the
// preload in test/setup.ts; these helpers cover the pieces happy-dom does not
// ship: pointing the shared window at a URL and a small Bun.build-based
// bundler for the transform-chain and tree-shake guards.

// happy-dom's `happyDOM` handle is not in the standard DOM lib; declare just
// what the helpers touch.
declare global {
  interface Window {
    happyDOM: { setURL(url: string): void };
  }
}

export const flush = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
export const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await flush();
};

// Point the shared happy-dom window at `url`. The router drives the real
// History API, so no Navigation API mock is needed; history entries persist
// across tests in the file (happy-dom never resets the stack), so each test
// boots its own router as a fresh mirror and never traverses past its own
// entries.
export function useHistory(url = 'http://localhost/') {
  window.happyDOM.setURL(url);
  window.scrollTo = () => {};
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

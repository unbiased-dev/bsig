// bsig plugin for Bun's bundler (HTML routes / Bun.build).
// Same auto-thunk transform as the Vite plugin, so .tsx sources keep
// plain-value ergonomics ({count.value}) and stay reactive.
//
// bunfig.toml:
//   [serve.static]
//   plugins = ["bsig/bun-plugin"]
//
// Uses node:fs (not Bun.file) so the hook also runs under plain node,
// which is how the test suite exercises it.
import { readFile } from 'node:fs/promises';
import { transformBsig } from './transform.js';

const bsigBunPlugin = {
  name: 'bsig',
  setup(build) {
    build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
      const loader = args.path.endsWith('.tsx') ? 'tsx' : 'jsx';
      const source = await readFile(args.path, 'utf8');
      // Leave vendored code alone; always return contents so Bun keeps
      // its default handling for files with nothing to transform.
      if (args.path.includes('node_modules')) return { contents: source, loader };
      const out = await transformBsig(source, args.path);
      return { contents: out ? out.code : source, loader };
    });
  },
};

export default bsigBunPlugin;

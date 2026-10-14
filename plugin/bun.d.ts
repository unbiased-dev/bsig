/**
 * Types for the bsig Bun plugin (`bsig/bun-plugin`).
 * Self-contained on purpose: no `bun` import, so these resolve in any
 * project. The object is structurally assignable to Bun's `BunPlugin`.
 */
export interface BunOnLoadArgs {
  path: string;
}

export interface BunOnLoadResult {
  contents: string;
  loader: 'jsx' | 'tsx';
}

export interface BunBuildLike {
  onLoad(
    opts: { filter: RegExp },
    cb: (args: BunOnLoadArgs) => Promise<BunOnLoadResult | undefined>
  ): void;
}

declare const bsigBunPlugin: {
  name: 'bsig';
  setup(build: BunBuildLike): void;
};

export default bsigBunPlugin;

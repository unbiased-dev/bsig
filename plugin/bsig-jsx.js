import { transformBsig } from './transform.js';

export default function bsig(opts = {}) {
  return {
    name: 'vite-plugin-bsig',
    enforce: 'pre',
    async transform(code, id) {
      return transformBsig(code, id, opts);
    },
  };
}

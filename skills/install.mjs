#!/usr/bin/env node
/* Install the bsig agent skill into the current project (or global config).
 *
 *   npx -p github:unbiased-dev/bsig#v0.4.0 bsig-skill
 *   npx -p github:unbiased-dev/bsig#v0.4.0 bsig-skill --opencode
 *   npx -p github:unbiased-dev/bsig#v0.4.0 bsig-skill --global
 *   bunx --package github:unbiased-dev/bsig#v0.4.0 bsig-skill
 *
 * Resolves SKILL.md relative to this file (never cwd), so it works from an
 * npx/bunx cache as well as from node_modules/bsig.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'bsig', 'SKILL.md');

const out = (s) => process.stdout.write(s + '\n');
const fail = (s) => {
  process.stderr.write(`bsig-skill: ${s}\n`);
  process.exit(1);
};

const raw = process.argv.slice(2);
const args = raw[0] === 'skill' || raw[0] === 'skills' ? raw.slice(1) : raw;

if (args.includes('--help') || args.includes('-h')) {
  out('usage: bsig-skill [--opencode | --claude | --global] [--dest <dir>]');
  out('');
  out('  (default)  .agents/skills/bsig/   project skill (OpenCode + Claude + others)');
  out('  --opencode .opencode/skills/bsig/  OpenCode project skill');
  out('  --claude   .claude/skills/bsig/    Claude Code project skill');
  out('  --global   ~/.config/opencode/skills/bsig/  OpenCode global skill');
  out('  --dest     explicit directory to install into');
  process.exit(0);
}

if (!fs.existsSync(SRC)) fail(`skill source missing: ${SRC}`);

const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) fail(`${name} needs a value`);
  return v;
};

const destFlag = flag('--dest');
let dest;
if (destFlag) {
  dest = path.resolve(destFlag);
} else if (args.includes('--global')) {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  dest = path.join(base, 'opencode', 'skills', 'bsig');
} else if (args.includes('--opencode')) {
  dest = path.join(process.cwd(), '.opencode', 'skills', 'bsig');
} else if (args.includes('--claude')) {
  dest = path.join(process.cwd(), '.claude', 'skills', 'bsig');
} else {
  dest = path.join(process.cwd(), '.agents', 'skills', 'bsig');
}

fs.mkdirSync(dest, { recursive: true });
const target = path.join(dest, 'SKILL.md');
const existed = fs.existsSync(target);
fs.copyFileSync(SRC, target);
out(`${existed ? 'updated' : 'installed'} ${target}`);
out('agents pick it up automatically — mention bsig or @bsig in your next prompt.');

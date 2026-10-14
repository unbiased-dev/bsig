#!/usr/bin/env node
/* Install a bsig agent skill into the current project (or global config).
 *
 *   npx -p github:unbiased-dev/bsig#v0.5.0 bsig-skill           # bsig skill
 *   npx -p github:unbiased-dev/bsig#v0.5.0 bsig-skill router    # router skill
 *   npx -p github:unbiased-dev/bsig#v0.5.0 bsig-router-skill    # router skill
 *   npx -p github:unbiased-dev/bsig#v0.5.0 bsig-skill router --opencode
 *
 * Resolves the skill relative to this file (never cwd), so it works from an
 * npx/bunx cache as well as from node_modules/bsig.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = ['bsig', 'router'];

const out = (s) => process.stdout.write(s + '\n');
const fail = (s) => {
  process.stderr.write(`bsig-skill: ${s}\n`);
  process.exit(1);
};

const raw = process.argv.slice(2);
let args = raw[0] === 'skill' || raw[0] === 'skills' ? raw.slice(1) : raw;
// `bsig-router-skill` sets BSIG_SKILL_DEFAULT=router before importing this file.
let skill = SKILLS.includes(process.env.BSIG_SKILL_DEFAULT)
  ? process.env.BSIG_SKILL_DEFAULT
  : 'bsig';
if (args[0] && SKILLS.includes(args[0])) {
  skill = args[0];
  args = args.slice(1);
}

if (args.includes('--help') || args.includes('-h')) {
  out('usage: bsig-skill [skill] [--opencode | --claude | --global] [--dest <dir>]');
  out('');
  out('  skill      bsig (default) | router');
  out('  (default)  .agents/skills/<skill>/   project skill (OpenCode + Claude + others)');
  out('  --opencode .opencode/skills/<skill>/  OpenCode project skill');
  out('  --claude   .claude/skills/<skill>/    Claude Code project skill');
  out('  --global   ~/.config/opencode/skills/<skill>/  OpenCode global skill');
  out('  --dest     explicit directory to install into');
  process.exit(0);
}

const SRC = path.join(here, skill, 'SKILL.md');
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
  dest = path.join(base, 'opencode', 'skills', skill);
} else if (args.includes('--opencode')) {
  dest = path.join(process.cwd(), '.opencode', 'skills', skill);
} else if (args.includes('--claude')) {
  dest = path.join(process.cwd(), '.claude', 'skills', skill);
} else {
  dest = path.join(process.cwd(), '.agents', 'skills', skill);
}

fs.mkdirSync(dest, { recursive: true });
const target = path.join(dest, 'SKILL.md');
const existed = fs.existsSync(target);
fs.copyFileSync(SRC, target);
out(`${existed ? 'updated' : 'installed'} ${target}`);
out('agents pick it up automatically — mention bsig or @bsig in your next prompt.');

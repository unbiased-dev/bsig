#!/usr/bin/env node
/* Install the bsig auth skill — alias for `bsig-skill auth`. */
process.env.BSIG_SKILL_DEFAULT = 'auth';
await import('./install.mjs');

#!/usr/bin/env node
/* Install the bsig router skill — alias for `bsig-skill router`. */
process.env.BSIG_SKILL_DEFAULT = 'router';
await import('./install.mjs');

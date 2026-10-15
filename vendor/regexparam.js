/*
 * Vendored from regexparam v3.0.0 — https://github.com/lukeed/regexparam
 * MIT © Luke Edwards <luke.edwards05@gmail.com>. See ./regexparam.LICENSE.
 *
 * Trimmed for bsig/router: only `parse` is kept, with string patterns only
 * (`:param`, `:param?`, `*`). Upstream's `inject` helper, RegExp input, and
 * `.ext` suffix support are not used by the router, so they are dropped to
 * keep the router bundle as small as the feature set allows.
 *
 * @param {string} input The route pattern
 * @param {boolean} [loose] Allow open-ended matching (parent routes).
 */
export function parse(input, loose) {
	var c, o, tmp, keys=[], pattern='', arr = input.split('/');
	arr[0] || arr.shift();

	while (tmp = arr.shift()) {
		c = tmp[0];
		if (c === '*') {
			keys.push(c);
			pattern += tmp[1] === '?' ? '(?:/(.*))?' : '/(.*)';
		} else if (c === ':') {
			o = tmp.indexOf('?', 1);
			keys.push(tmp.substring(1, !!~o ? o : tmp.length));
			pattern += !!~o ? '(?:/([^/]+?))?' : '/([^/]+?)';
		} else {
			pattern += '/' + tmp;
		}
	}

	return {
		keys: keys,
		pattern: new RegExp('^' + pattern + (loose ? '(?=$|\/)' : '\/?$'), 'i')
	};
}

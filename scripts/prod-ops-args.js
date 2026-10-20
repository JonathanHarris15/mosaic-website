/**
 * @fileoverview Validate and split workflow `args` without invoking a shell.
 */

const FORBIDDEN_ARGS = /[;&|`]|\$\(|[\r\n]/;

/**
 * @param {string} input
 * @returns {void}
 */
function assertSafeOpsArgsString(input) {
    if (input == null || input === '') return;
    if (FORBIDDEN_ARGS.test(input)) {
        throw new Error(
            'args must not contain shell metacharacters (; & | ` $( or newlines).');
    }
}

/**
 * Bash-like tokenization for a single line of extra script flags.
 *
 * @param {string} input
 * @returns {string[]}
 */
function splitOpsArgs(input) {
    assertSafeOpsArgsString(input);
    const s = String(input).trim();
    if (!s) return [];

    const out = [];
    let i = 0;
    while (i < s.length) {
        while (i < s.length && /\s/.test(s[i])) i += 1;
        if (i >= s.length) break;

        const quote = s[i] === '"' || s[i] === '\'' ? s[i] : null;
        if (quote) {
            i += 1;
            let token = '';
            while (i < s.length && s[i] !== quote) {
                if (s[i] === '\\' && i + 1 < s.length) {
                    token += s[i + 1];
                    i += 2;
                    continue;
                }
                token += s[i];
                i += 1;
            }
            if (i >= s.length || s[i] !== quote) {
                throw new Error('Unclosed quote in args.');
            }
            i += 1;
            out.push(token);
            continue;
        }

        let token = '';
        while (i < s.length && !/\s/.test(s[i])) {
            token += s[i];
            i += 1;
        }
        out.push(token);
    }
    return out;
}

module.exports = {assertSafeOpsArgsString, splitOpsArgs, FORBIDDEN_ARGS};

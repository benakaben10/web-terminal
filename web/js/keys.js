/* Hotkey model for the on-screen keyboard bar.
 *
 * A key is one of:
 *   kind:'key'    -> writes `seq` to the pty (modifiers applied first)
 *   kind:'mod'    -> sticky modifier toggle ('ctrl' | 'alt' | 'shift')
 *   kind:'action' -> a UI action handled by app.js
 */
(function (global) {
  'use strict';

  const ESC = '\x1b';

  /** Canonical escape sequences, exposed so the custom-key editor can offer them. */
  const SEQUENCES = {
    escape: ESC,
    tab: '\t',
    backtab: ESC + '[Z',
    enter: '\r',
    backspace: '\x7f',
    space: ' ',
    up: ESC + '[A',
    down: ESC + '[B',
    right: ESC + '[C',
    left: ESC + '[D',
    home: ESC + '[H',
    end: ESC + '[F',
    pageup: ESC + '[5~',
    pagedown: ESC + '[6~',
    insert: ESC + '[2~',
    delete: ESC + '[3~',
    f1: ESC + 'OP',
    f2: ESC + 'OQ',
    f3: ESC + 'OR',
    f4: ESC + 'OS',
    f5: ESC + '[15~',
    f6: ESC + '[17~',
    f7: ESC + '[18~',
    f8: ESC + '[19~',
    f9: ESC + '[20~',
    f10: ESC + '[21~',
    f11: ESC + '[23~',
    f12: ESC + '[24~',
  };

  /** Ctrl-code for a printable character, e.g. ctrlSeq('c') -> '\x03'. */
  function ctrlSeq(ch) {
    const c = String(ch);
    const code = c.toUpperCase().charCodeAt(0);
    if (code >= 64 && code < 128) return String.fromCharCode(code & 0x1f);
    if (c === ' ') return '\x00';
    if (c === '?') return '\x7f';
    return c;
  }

  const k = (id, label, seq, extra) => Object.assign({ id, label, seq, kind: 'key' }, extra || {});
  const ctrl = (ch, label) => k('c-' + ch, label || '^' + ch.toUpperCase(), ctrlSeq(ch));
  const mod = (id, label) => ({ id, label, kind: 'mod', mod: id });
  const act = (id, label, icon) => ({ id, label, kind: 'action', action: id, icon });

  /* Default layout. Each group is one horizontally scrollable row. */
  const DEFAULT_LAYOUT = [
    {
      id: 'nav',
      label: 'Điều hướng',
      keys: [
        mod('ctrl', 'Ctrl'),
        mod('alt', 'Alt'),
        k('esc', 'Esc', SEQUENCES.escape),
        k('tab', 'Tab', SEQUENCES.tab),
        k('left', '←', SEQUENCES.left, { repeat: true }),
        k('down', '↓', SEQUENCES.down, { repeat: true }),
        k('up', '↑', SEQUENCES.up, { repeat: true }),
        k('right', '→', SEQUENCES.right, { repeat: true }),
        k('home', 'Home', SEQUENCES.home),
        k('end', 'End', SEQUENCES.end),
        k('pgup', 'PgUp', SEQUENCES.pageup),
        k('pgdn', 'PgDn', SEQUENCES.pagedown),
      ],
    },
    {
      id: 'combo',
      label: 'Tổ hợp Ctrl',
      keys: [
        ctrl('c'),
        ctrl('d'),
        ctrl('z'),
        ctrl('l'),
        ctrl('r'),
        ctrl('a'),
        ctrl('e'),
        ctrl('k'),
        ctrl('u'),
        ctrl('w'),
        ctrl('q'),
        ctrl('s'),
        k('c-bslash', '^\\', '\x1c'),
        k('c-rbracket', '^]', '\x1d'),
        k('bksp', '⌫', SEQUENCES.backspace, { repeat: true }),
        k('del', 'Del', SEQUENCES.delete),
        k('enter', '⏎', SEQUENCES.enter),
      ],
    },
    {
      id: 'symbols',
      label: 'Ký tự',
      keys: [
        k('sym-slash', '/', '/'),
        k('sym-bslash', '\\', '\\'),
        k('sym-pipe', '|', '|'),
        k('sym-dash', '-', '-'),
        k('sym-under', '_', '_'),
        k('sym-tilde', '~', '~'),
        k('sym-grave', '`', '`'),
        k('sym-dollar', '$', '$'),
        k('sym-hash', '#', '#'),
        k('sym-amp', '&', '&'),
        k('sym-star', '*', '*'),
        k('sym-caret', '^', '^'),
        k('sym-percent', '%', '%'),
        k('sym-bang', '!', '!'),
        k('sym-quest', '?', '?'),
        k('sym-colon', ':', ':'),
        k('sym-semi', ';', ';'),
        k('sym-dquote', '"', '"'),
        k('sym-squote', "'", "'"),
        k('sym-lparen', '(', '('),
        k('sym-rparen', ')', ')'),
        k('sym-lbrack', '[', '['),
        k('sym-rbrack', ']', ']'),
        k('sym-lbrace', '{', '{'),
        k('sym-rbrace', '}', '}'),
        k('sym-lt', '<', '<'),
        k('sym-gt', '>', '>'),
        k('sym-eq', '=', '='),
        k('sym-plus', '+', '+'),
        k('sym-at', '@', '@'),
      ],
    },
    {
      id: 'fn',
      label: 'Phím chức năng',
      keys: Array.from({ length: 12 }, (_, i) =>
        k('f' + (i + 1), 'F' + (i + 1), SEQUENCES['f' + (i + 1)])
      ),
    },
    {
      id: 'macro',
      label: 'Lệnh nhanh',
      // No trailing \r on purpose: a quick command types itself at the prompt
      // and waits there, so a mistap costs a backspace rather than a command
      // that already ran. Add `\r` in the editor for one that should fire.
      keys: [
        k('m-ls', 'ls -la', 'ls -la'),
        k('m-clear', 'clear', 'clear'),
        k('m-top', 'htop', 'htop'),
        k('m-df', 'df -h', 'df -h'),
        k('m-cdup', 'cd ..', 'cd ..'),
        k('m-git', 'git status', 'git status'),
        act('keyboard', 'Bàn phím', '⌨'),
        act('normalScreen', 'Sửa màn hình', '⛶'),
        act('paste', 'Dán', '📋'),
        act('copy', 'Chép', '⧉'),
        act('inputBar', 'Ô nhập', '✎'),
      ],
    },
  ];

  const STORAGE_KEY = 'wt.keylayout.v2';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isValidKey(key) {
    if (!key || typeof key !== 'object' || typeof key.label !== 'string') return false;
    if (key.kind === 'mod') return ['ctrl', 'alt', 'shift'].includes(key.mod);
    if (key.kind === 'action') return typeof key.action === 'string';
    return typeof key.seq === 'string';
  }

  function sanitize(layout) {
    if (!Array.isArray(layout)) return null;
    const groups = layout
      .filter((g) => g && typeof g === 'object' && Array.isArray(g.keys))
      .map((g, gi) => ({
        id: String(g.id || 'group' + gi).slice(0, 32),
        label: String(g.label || 'Nhóm ' + (gi + 1)).slice(0, 32),
        keys: g.keys.filter(isValidKey).map((key, ki) => ({
          id: String(key.id || g.id + '-' + ki).slice(0, 48),
          label: String(key.label).slice(0, 12),
          kind: key.kind === 'mod' || key.kind === 'action' ? key.kind : 'key',
          seq: typeof key.seq === 'string' ? key.seq : undefined,
          mod: key.mod,
          action: key.action,
          repeat: Boolean(key.repeat),
          wide: Boolean(key.wide),
        })),
      }))
      .filter((g) => g.keys.length > 0);
    return groups.length ? groups : null;
  }

  /**
   * Add a key that shipped after this layout was saved.
   *
   * A stored layout is authoritative — it is the user's arrangement — so a new
   * action would otherwise never appear for anyone who has touched the editor.
   * Only ever appended, and only when nothing already bound to that action.
   */
  function addMissingAction(layout, action, label, icon) {
    const bound = layout.some((group) => group.keys.some((key) => key.action === action));
    if (bound) return;
    const group = layout.find((g) => g.id === 'macro') || layout[layout.length - 1];
    if (!group) return;
    group.keys.push({ id: action, label, kind: 'action', action, icon });
  }

  const NO_ENTER_KEY = 'wt.keylayout.noenter.v1';

  /**
   * Drop the trailing Enter that text macros used to carry.
   *
   * A stored layout is the user's own, so this runs exactly once and is then
   * remembered: someone who puts the `\r` back keeps it. Only multi-character
   * plain text is touched — the bare Enter key, Ctrl-codes and arrow sequences
   * all contain control bytes and are left alone.
   */
  function dropMacroEnter(layout) {
    if (localStorage.getItem(NO_ENTER_KEY)) return false;
    localStorage.setItem(NO_ENTER_KEY, '1');
    let changed = false;
    for (const group of layout) {
      for (const key of group.keys) {
        if (key.kind !== 'key' || typeof key.seq !== 'string') continue;
        if (key.seq.length < 2 || !key.seq.endsWith('\r')) continue;
        if (/[\x00-\x1f\x7f]/.test(key.seq.slice(0, -1))) continue;
        key.seq = key.seq.slice(0, -1);
        changed = true;
      }
    }
    return changed;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(DEFAULT_LAYOUT);
      const stored = sanitize(JSON.parse(raw));
      if (!stored) return clone(DEFAULT_LAYOUT);
      addMissingAction(stored, 'keyboard', 'Bàn phím', '⌨');
      addMissingAction(stored, 'normalScreen', 'Sửa màn hình', '⛶');
      if (dropMacroEnter(stored)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      }
      return stored;
    } catch {
      return clone(DEFAULT_LAYOUT);
    }
  }

  function save(layout) {
    const clean = sanitize(layout);
    if (!clean) throw new Error('Bố cục phím không hợp lệ');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    return clean;
  }

  /** Turn a human string like "\e[A" or "^C" into the real byte sequence. */
  function parseSequence(input) {
    return String(input)
      .replace(/\\e|\\E/g, ESC)
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\0/g, '\x00')
      .replace(/\^([A-Za-z@[\]\\^_?])/g, (_, c) => ctrlSeq(c))
      .replace(/\\\\/g, '\\');
  }

  /** Inverse of parseSequence, for showing a sequence in the editor. */
  function formatSequence(seq) {
    return String(seq)
      .split('')
      .map((ch) => {
        const code = ch.charCodeAt(0);
        if (ch === ESC) return '\\e';
        if (ch === '\r') return '\\r';
        if (ch === '\n') return '\\n';
        if (ch === '\t') return '\\t';
        if (code < 32 || code === 127) return '\\x' + code.toString(16).padStart(2, '0');
        return ch;
      })
      .join('');
  }

  global.WTKeys = {
    SEQUENCES,
    DEFAULT_LAYOUT,
    ctrlSeq,
    load,
    save,
    sanitize,
    parseSequence,
    formatSequence,
    clone,
  };
})(window);

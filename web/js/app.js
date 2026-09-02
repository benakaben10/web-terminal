/* Web Terminal — mobile-first client.
 * One xterm instance per session tab; sessions live on the server, so a
 * dropped mobile connection reattaches to the same shell with scrollback. */
(function () {
  'use strict';

  /* ------------------------------------------------------------- helpers */

  const SCRIPT_URL = new URL(document.currentScript.src);
  const BASE = SCRIPT_URL.pathname.replace(/\/js\/app\.js.*$/, '');
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function fmtBytes(n) {
    if (!Number.isFinite(n)) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function fmtDuration(sec) {
    if (!Number.isFinite(sec)) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}n ${h}g`;
    if (h) return `${h}g ${m}p`;
    return `${m}p`;
  }

  function toast(message, kind) {
    const node = el('div', 'toast', message);
    if (kind) node.dataset.kind = kind;
    $('toasts').appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function haptic(ms) {
    if (settings.haptics && navigator.vibrate) {
      try { navigator.vibrate(ms || 8); } catch { /* blocked */ }
    }
  }

  /* ------------------------------------------------------------ settings */

  /* iPadOS reports itself as a Mac, so touch points are what give it away.
     Safari is the engine that refuses to open its keyboard for an invisible
     field — the reason the visible input bar exists. Note Safari reports
     maxTouchPoints as 0 on iPhone in some configurations, so touch detection
     must not be the only signal. */
  const IS_IOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1);
  const IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  const IS_TOUCH =
    (navigator.maxTouchPoints || 0) > 0 ||
    'ontouchstart' in window ||
    window.matchMedia?.('(pointer: coarse)').matches === true;

  const SETTINGS_KEY = 'wt.settings.v2';
  const DEFAULT_SETTINGS = {
    fontSize: 14,
    theme: 'dark',
    cursorBlink: true,
    wrapKeys: false,
    haptics: true,
    // Opt-in, and it has to be: it assumes the alternate screen belongs to
    // tmux. 'off' | 'ctrl-b' | 'ctrl-a' — the value doubles as the prefix.
    tmuxScroll: 'off',
    autoReconnect: true,
    bell: false,
    keybarVisible: true,
    keybarGroup: 'nav',
    // Touch devices are exactly the ones whose keyboards need a composing
    // region (Telex/VNI, kana, pinyin), so default the composer on there.
    imeMode: IS_TOUCH || IS_IOS || IS_SAFARI,
    preedit: true,
    // Off by default: the suggestion strip costs a real band of height on a
    // phone and that space is worth more. The trade is a less accurate Telex,
    // because the IME loses the place it shows composing text — turn it back
    // on under Settings → Input.
    suggestions: false,
    // Marks the new default as applied, so it overrides a previously stored
    // value exactly once and respects the user's choice from then on.
    suggestionsDefaultV2: true,
    // Opt-in. The visible bar changes how the terminal is typed into — a line
    // is composed, then sent — so it is never turned on for someone.
    inputBar: 'off',
  };

  let settings = loadSettings();

  function loadSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      const merged = Object.assign({}, DEFAULT_SETTINGS, stored);
      // Settings written before the input bar existed carry an imeMode derived
      // from maxTouchPoints alone, which Safari can report as 0. Recompute it
      // for them rather than leaving those clients stuck without a composer.
      if (!('inputBar' in stored)) merged.imeMode = DEFAULT_SETTINGS.imeMode;
      // 'auto' used to mean "forced on iOS/Safari"; it is off like anything
      // else now, so nothing is left that can turn the bar on by itself.
      merged.inputBar = merged.inputBar === 'on' ? 'on' : 'off';
      if (!stored.suggestionsDefaultV2) {
        merged.suggestions = DEFAULT_SETTINGS.suggestions;
        merged.suggestionsDefaultV2 = true;
      }
      return merged;
    } catch {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }

  /* -------------------------------------------------------------- themes */

  const THEMES = {
    dark: { chrome: 'dark', xterm: { background: '#0d1117', foreground: '#e6edf3', cursor: '#4f9cf9', cursorAccent: '#0d1117', selectionBackground: 'rgba(79,156,249,0.32)', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' } },
    light: { chrome: 'light', xterm: { background: '#ffffff', foreground: '#1f2328', cursor: '#0969da', cursorAccent: '#ffffff', selectionBackground: 'rgba(9,105,218,0.20)', black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781', brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f' } },
    dracula: { chrome: 'dark', xterm: { background: '#282a36', foreground: '#f8f8f2', cursor: '#ff79c6', cursorAccent: '#282a36', selectionBackground: 'rgba(189,147,249,0.35)', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' } },
    'solarized-dark': { chrome: 'dark', xterm: { background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', cursorAccent: '#002b36', selectionBackground: 'rgba(147,161,161,0.28)', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' } },
    nord: { chrome: 'dark', xterm: { background: '#2e3440', foreground: '#d8dee9', cursor: '#88c0d0', cursorAccent: '#2e3440', selectionBackground: 'rgba(136,192,208,0.30)', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' } },
    gruvbox: { chrome: 'dark', xterm: { background: '#282828', foreground: '#ebdbb2', cursor: '#fe8019', cursorAccent: '#282828', selectionBackground: 'rgba(254,128,25,0.28)', black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984', brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' } },
  };

  function currentTheme() {
    return THEMES[settings.theme] || THEMES.dark;
  }

  function applyChrome() {
    const theme = currentTheme();
    document.documentElement.dataset.theme = theme.chrome;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.xterm.background);
    document.body.style.background = theme.xterm.background;
  }

  /* ---------------------------------------------------------------- auth */

  const TOKEN_KEY = 'wt.token';
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let serverConfig = { authRequired: false, title: 'Web Terminal', readOnly: false };

  async function api(path, options) {
    const opts = Object.assign({ headers: {} }, options);
    opts.headers = Object.assign({}, opts.headers);
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(BASE + path, opts);
    if (res.status === 401) {
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      throw new Error('unauthorized');
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function showLogin(message) {
    $('login').hidden = false;
    $('app').hidden = true;
    $('loginError').textContent = message || '';
    setTimeout(() => $('loginPass').focus(), 60);
  }

  /* ------------------------------------------------------------ keyboard */

  const mods = { ctrl: false, alt: false, shift: false };
  const modLocks = { ctrl: false, alt: false, shift: false };
  let keyLayout = window.WTKeys.load();

  function toggleMod(name) {
    if (modLocks[name]) {
      modLocks[name] = false;
      mods[name] = false;
    } else if (mods[name]) {
      modLocks[name] = true; // second tap locks it until tapped again
    } else {
      mods[name] = true;
    }
    renderKeyRows();
  }

  function clearOneShotMods() {
    let changed = false;
    for (const name of Object.keys(mods)) {
      if (mods[name] && !modLocks[name]) { mods[name] = false; changed = true; }
    }
    if (changed) renderKeyRows();
  }

  /** Apply sticky Ctrl/Alt to a chunk of input on its way to the pty. */
  function applyMods(data) {
    let out = data;
    if (mods.ctrl && out.length === 1) out = window.WTKeys.ctrlSeq(out);
    if (mods.shift && out.length === 1) out = out.toUpperCase();
    if (mods.alt) out = '\x1b' + out;
    clearOneShotMods();
    return out;
  }

  /* ------------------------------------------------------------------- IME
   *
   * Mobile keyboards commit text through composition events, not keystrokes:
   * Gboard's Vietnamese Telex holds "tieengs" in a composing region and only
   * emits "tiếng" on compositionend. xterm's helper textarea disables that
   * region, so we own a textarea of our own, let the IME run at full strength
   * in it, and forward only committed text to the pty.
   */

  const ime = {
    el: null,
    composing: false,
    enabled: () => settings.imeMode,
  };

  function sendInput(text) {
    if (!text || !activeTab) return;
    leaveTmuxCopyMode();
    activeTab.send(text.length === 1 ? applyMods(text) : withAltPrefix(text));
  }

  function showPreedit(text) {
    if (!settings.preedit || !text) return hidePreedit();
    $('preeditText').textContent = text;
    $('preedit').hidden = false;
  }

  function hidePreedit() {
    $('preedit').hidden = true;
    $('preeditText').textContent = '';
  }

  /** Escape sequence for a non-printable key, or null to let `input` handle it. */
  function specialKeySeq(event) {
    const S = window.WTKeys.SEQUENCES;
    if (event.ctrlKey && event.key.length === 1) return window.WTKeys.ctrlSeq(event.key);
    if (event.altKey && event.key.length === 1) return '\x1b' + event.key;
    switch (event.key) {
      case 'Enter': return S.enter;
      case 'Backspace': return S.backspace;
      case 'Tab': return event.shiftKey ? S.backtab : S.tab;
      case 'Escape': return S.escape;
      case 'ArrowUp': return S.up;
      case 'ArrowDown': return S.down;
      case 'ArrowLeft': return S.left;
      case 'ArrowRight': return S.right;
      case 'Home': return S.home;
      case 'End': return S.end;
      case 'PageUp': return S.pageup;
      case 'PageDown': return S.pagedown;
      case 'Delete': return S.delete;
      case 'Insert': return S.insert;
      default: return null;
    }
  }

  /** Visible bar, or the invisible overlay? Only ever what the user asked for. */
  function inputBarVisible() {
    return settings.inputBar === 'on';
  }

  /** Is any composer holding input, as opposed to xterm's own textarea? */
  function composerActive() {
    return inputBarVisible() || settings.imeMode;
  }

  function applyInputBar() {
    const mode = inputBarVisible() ? 'bar' : 'overlay';
    $('inputBar').dataset.mode = mode;
    if (mode === 'overlay') ime.el.value = '';
    for (const tab of tabs) tab.resize(true);
  }

  /** Text carrying no control bytes — safe to sit in a field and be edited. */
  function isPlainText(seq) {
    return typeof seq === 'string' && seq.length > 0 && !/[\x00-\x1f\x7f]/.test(seq);
  }

  /**
   * Put a hotkey's text into the visible input bar instead of the pty.
   *
   * In bar mode the user is composing a line and only sends it with ➤, so a
   * macro fired at the pty would land underneath whatever is still in the
   * field. Inserted at the caret, so it composes with what is already typed.
   */
  function insertIntoBar(text) {
    const el = ime.el;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const caret = start + text.length;
    try { el.setSelectionRange(caret, caret); } catch { /* detached field */ }
    autoGrowBar();
    focusInput();
  }

  /** Bar mode edits a line locally and sends it whole; overlay mode streams. */
  function submitBar() {
    const text = ime.el.value;
    ime.el.value = '';
    hidePreedit();
    autoGrowBar();
    sendInput(text + window.WTKeys.SEQUENCES.enter);
  }

  function autoGrowBar() {
    if (!inputBarVisible()) return;
    ime.el.style.height = 'auto';
    ime.el.style.height = Math.min(96, ime.el.scrollHeight) + 'px';
  }

  function setupIME() {
    const input = $('imeInput');
    ime.el = input;

    input.addEventListener('compositionstart', () => {
      ime.composing = true;
      showPreedit(input.value);
    });

    input.addEventListener('compositionupdate', (event) => {
      showPreedit(event.data ?? input.value);
    });

    input.addEventListener('compositionend', (event) => {
      ime.composing = false;
      hidePreedit();
      if (inputBarVisible()) return autoGrowBar(); // the composed text stays in the bar
      // Chromium fires `input` after this with the same text; clearing the field
      // first makes that follow-up a no-op instead of a duplicate.
      const text = event.data ?? input.value;
      input.value = '';
      if (text) sendInput(text);
    });

    // Some Android IMEs never fire keydown for Enter/Backspace (keyCode 229);
    // beforeinput always reports the intent, so act on it there.
    // Some Android IMEs never fire keydown for Enter/Backspace (keyCode 229);
    // beforeinput always reports the intent, so act on it there.
    input.addEventListener('beforeinput', (event) => {
      if (ime.composing) return;
      if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
        event.preventDefault();
        return inputBarVisible() ? submitBar() : sendInput(window.WTKeys.SEQUENCES.enter);
      }
      // An empty field has nothing to delete, so forward the intent instead.
      if (event.inputType === 'deleteContentBackward' && !input.value) {
        event.preventDefault();
        return sendInput(window.WTKeys.SEQUENCES.backspace);
      }
    });

    input.addEventListener('input', () => {
      if (ime.composing) return showPreedit(input.value);
      if (inputBarVisible()) return autoGrowBar(); // edited locally, sent on submit
      const text = input.value;
      if (!text) return;
      input.value = '';
      sendInput(text);
    });

    input.addEventListener('keydown', (event) => {
      // 229 is the "IME is handling this" sentinel; never intercept it.
      if (ime.composing || event.isComposing || event.keyCode === 229) return;
      if (inputBarVisible()) {
        // The bar is an ordinary text field: only Enter is ours. Ctrl/arrows/Esc
        // reach the pty through the hotkey bar, which writes to it directly.
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submitBar();
        }
        return;
      }
      const seq = specialKeySeq(event);
      if (seq === null) return; // printable — the input event will carry it
      event.preventDefault();
      sendInput(seq);
    });

    $('btnSend').addEventListener('pointerdown', (event) => {
      event.preventDefault(); // keep focus (and the soft keyboard) on the field
      submitBar();
    });

    input.addEventListener('blur', () => {
      ime.composing = false;
      hidePreedit();
    });

    // A tap on the terminal hands the keyboard to our composer rather than
    // xterm's. This MUST run synchronously inside the gesture: iOS Safari only
    // opens the soft keyboard for a focus() call made during a user gesture, so
    // deferring it by even a setTimeout(0) silently does nothing.
    const focusOnTap = () => {
      // A scroll or a select gesture ends with the same up-events as a tap.
      // Focusing there would open the soft keyboard, and that resize is what
      // used to throw the reader back to the bottom of the scrollback.
      if (performance.now() < touch.quietUntil) return;
      if (activeTab?.term.hasSelection()) { activeTab.term.clearSelection(); return; }
      if (!composerActive()) return;
      focusInput();
    };
    const terminal = $('terminal');
    terminal.addEventListener('pointerup', focusOnTap);
    terminal.addEventListener('touchend', focusOnTap);
    terminal.addEventListener('click', focusOnTap);
  }

  /**
   * Turn the keyboard's suggestion strip on or off.
   *
   * On iOS the predictive bar is tied to autocorrect, so switching autocorrect
   * off is the only lever a page has — and it is the same lever the IME uses:
   * the strip is where Gboard and the iOS keyboard show a composing Vietnamese
   * word before committing it. Hence a setting rather than a default.
   */
  function applySuggestions() {
    const on = settings.suggestions;
    const targets = [ime.el, ...tabs.map((t) => t.term.textarea)].filter(Boolean);
    for (const el of targets) {
      el.setAttribute('autocorrect', on ? 'on' : 'off');
      el.setAttribute('spellcheck', on ? 'true' : 'false');
      el.setAttribute('autocapitalize', 'none');
      if (on) el.removeAttribute('autocomplete');
      else el.setAttribute('autocomplete', 'off');
    }
  }

  /**
   * Drag the terminal back out of a stuck full-screen state.
   *
   * A program killed outright never gets to send `\e[?1049l`, so the terminal
   * stays on the alternate screen: the shell keeps working but every line it
   * writes lands in a buffer with no scrollback, and nothing scrolls. Same for
   * mouse reporting a dead program left switched on. Written into the terminal,
   * not the pty — this is the emulator's state to fix, not the program's.
   */
  function restoreNormalScreen() {
    const term = activeTab?.term;
    if (!term) return;
    const stuck = term.buffer.active.type === 'alternate';
    tmuxCopy.active = false;
    term.write('\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h');
    updateScrollButton();
    toast(stuck ? 'Đã thoát chế độ toàn màn hình' : 'Màn hình đã ở chế độ thường', 'ok');
  }

  /**
   * Show or hide the soft keyboard.
   *
   * Nothing can ask for it directly — the keyboard follows focus, so the toggle
   * is focus and blur on whichever element owns input. This has to stay
   * synchronous inside the gesture: iOS only opens the keyboard for a focus()
   * made during one.
   */
  function toggleKeyboard() {
    const el = composerActive() ? ime.el : activeTab?.term.textarea;
    if (!el) return;
    if (document.activeElement === el) el.blur();
    else focusInput();
  }

  /** Route focus to whichever element currently owns keyboard input. */
  function focusInput() {
    if (composerActive() && ime.el) {
      try { ime.el.focus({ preventScroll: true }); return; } catch { /* fall through */ }
    }
    activeTab?.term.focus();
  }

  /* --------------------------------------------------- touch: scroll & select
   *
   * On a phone a drag is the only way into the scrollback, so it has to scroll
   * rather than send arrow keys. xterm ships touch scrolling of its own, but it
   * listens on `.xterm-screen` only, has no inertia, and goes quiet as soon as
   * an app turns on mouse tracking — so take the gesture in the capture phase
   * and drive the viewport from here.
   *
   * A long press turns the same finger into a selection. The gesture only
   * selects: copying is a separate tap on the button that appears while a
   * selection stands, so a stray drag can never overwrite the clipboard. The
   * selection has to be ours too: xterm paints it on a canvas, so the browser's
   * native long-press never finds text to grab.
   */

  const LONG_PRESS_MS = 500;
  const DRAG_THRESHOLD = 6;      // px of travel before a touch counts as a drag
  const HOLD_SLOP = 3;           // px a finger may drift and still be "held" 
  const GLIDE_FRICTION = 0.995;  // velocity retained per ms after release
  const WHEEL_NOTCH_LINES = 3;   // lines of travel per emulated wheel notch

  const touch = {
    mode: 'idle',   // idle | pending | scroll | select
    startX: 0,
    startY: 0,
    lastY: 0,
    lastT: 0,
    rest: 0,        // sub-line remainder carried between moves
    velocity: 0,    // lines per ms
    glide: 0,
    holdTimer: 0,
    anchor: null,   // [col, row] in absolute buffer coordinates
    quietUntil: 0,  // suppresses the tap-to-focus that trails a gesture
  };

  /**
   * Pixel size of one cell.
   *
   * Asked of the renderer first: dividing the screen element by the row count
   * gives a wrong answer whenever `fit()` and the last paint disagree, and a
   * cell that reads too tall silently turns every drag into zero lines.
   */
  function cellSize(term) {
    const dims = term._core?._renderService?.dimensions?.css?.cell;
    const screen = term.element?.querySelector('.xterm-screen');
    const guessH = settings.fontSize * 1.15;
    const guessW = settings.fontSize * 0.6;
    const h = dims?.height || (screen && term.rows ? screen.clientHeight / term.rows : 0) || guessH;
    const w = dims?.width || (screen && term.cols ? screen.clientWidth / term.cols : 0) || guessW;
    // A cell outside this range means something measured wrong; do not trust it.
    return {
      w: Math.min(64, Math.max(2, w)),
      h: Math.min(96, Math.max(4, h)),
    };
  }

  /**
   * What the last gesture actually did. Read back in the admin panel: a scroll
   * that does nothing has several possible causes and they are only
   * distinguishable from the device it fails on.
   */
  const diag = { moves: 0, lines: 0, keys: 0, wheel: 0, from: 0, to: 0, mode: '-' };

  function noteScroll(term, lines) {
    diag.lines += lines;
    diag.from = term.buffer.active.viewportY;
    diag.to = term.buffer.active.baseY;
  }

  /** Touch point -> [column, absolute buffer row], clamped to what is on screen. */
  function cellAt(term, clientX, clientY) {
    const screen = term.element?.querySelector('.xterm-screen');
    if (!screen) return [0, 0];
    const rect = screen.getBoundingClientRect();
    const { w, h } = cellSize(term);
    const col = Math.max(0, Math.min(term.cols - 1, Math.floor((clientX - rect.left) / w)));
    const row = Math.max(0, Math.min(term.rows - 1, Math.floor((clientY - rect.top) / h)));
    return [col, term.buffer.active.viewportY + row];
  }

  /**
   * Where a scroll gesture belongs.
   *
   * The normal buffer is always the terminal's own scrollback, even when the
   * program is reading the mouse. That order matters: Claude Code keeps mouse
   * reporting on for clicks while leaving its transcript in the scrollback, so
   * handing it the wheel would leave a phone with nothing to scroll — and no
   * shift+wheel to fall back on. A shell prompt, `cat` and `docker logs` are
   * the same case.
   *
   * The alternate screen genuinely has no scrollback, so there the program
   * decides: wheel notches if it reads the mouse (`vim`, `htop`, `less`),
   * otherwise the page keys a pager understands.
   *
   * Never arrow keys: xterm's own fallback turns a wheel into those whenever
   * the active buffer reports no scrollback, and a TUI reads them as
   * navigation. Both gesture handlers stop the event before xterm can do that.
   */
  function scrollTarget(term) {
    if (term.buffer.active.type !== 'alternate') return 'scrollback';
    if (term.modes.mouseTrackingMode !== 'none') return 'wheel';
    return 'pagekeys';
  }

  /**
   * Send the program wheel notches, the way a physical wheel delivers them.
   *
   * One notch per three lines of travel: `vim`'s `mousescroll` and `less`'s
   * `--wheel-lines` both move three lines per notch, so the content tracks the
   * finger. Encoding is xterm's job — protocol (X10/VT200/DRAG/ANY) and encoding
   * (DEFAULT/SGR/SGR_PIXELS) are whatever the program asked for. Button 4 is the
   * wheel; action 0 is up, 1 is down.
   *
   * Returns false when the program will not take it, so the caller can fall back
   * rather than leave the gesture dead.
   */
  function sendWheel(term, notches) {
    const mouse = term._core?.coreMouseService;
    if (!mouse || !notches) return false;
    const row = Math.max(0, Math.min(term.rows - 1, Math.floor(term.rows / 2)));
    const col = Math.max(0, Math.min(term.cols - 1, Math.floor(term.cols / 2)));
    const action = notches < 0 ? 0 : 1;
    let sent = false;
    for (let i = 0; i < Math.min(Math.abs(notches), 12); i++) {
      // A fresh object each time: triggerMouseEvent rewrites col/row in place.
      const ok = mouse.triggerMouseEvent({
        col, row, button: 4, action, ctrl: false, alt: false, shift: false,
      });
      sent = ok || sent;
    }
    if (sent) diag.wheel += Math.abs(notches);
    return sent;
  }

  /* --------------------------------------------------------- tmux copy-mode
   *
   * tmux holds the alternate screen for the whole session, so from here the
   * scrollback is empty and the history lives in tmux's own pane buffer — a
   * drag has nothing to move, which is why scrolling dies the moment a shell
   * is run inside tmux. tmux only hands that history over in copy-mode, so
   * with this on the first upward drag sends `prefix [` and the page keys
   * below then land in copy-mode, where they do scroll.
   *
   * Leaving is on us too: copy-mode reads ordinary keys as its own commands,
   * so anything typed afterwards has to be preceded by `q`.
   */
  const tmuxCopy = { active: false };

  function tmuxScrollOn() { return settings.tmuxScroll !== 'off'; }

  function enterTmuxCopyMode(tab) {
    tmuxCopy.active = true;
    tab.send((settings.tmuxScroll === 'ctrl-a' ? '\x01' : '\x02') + '[');
  }

  /** Drop out of copy-mode before anything else reaches the pane. */
  function leaveTmuxCopyMode(tab) {
    if (!tmuxCopy.active) return;
    tmuxCopy.active = false;
    (tab || activeTab)?.send('q');
  }

  let wheelRest = 0;
  let altPageRest = 0;

  /** Page keys: what a full-screen pager scrolls with when it ignores the mouse. */
  function sendPageKeys(tab, lines) {
    const step = Math.max(1, Math.floor(tab.term.rows / 2));
    altPageRest += lines;
    const pages = Math.trunc(altPageRest / step);
    if (!pages) return;
    altPageRest -= pages * step;
    const count = Math.min(Math.abs(pages), 8);
    const key = pages < 0 ? window.WTKeys.SEQUENCES.pageup : window.WTKeys.SEQUENCES.pagedown;
    diag.keys += count;
    tab.send(key.repeat(count));
  }

  /** Route `lines` of scroll to whichever of the three targets applies. */
  function applyScroll(tab, lines) {
    if (!lines || !tab) return;
    const term = tab.term;
    const target = scrollTarget(term);
    diag.mode = target;

    if (target === 'wheel') {
      wheelRest += lines;
      const notches = Math.trunc(wheelRest / WHEEL_NOTCH_LINES);
      if (!notches) return; // still accumulating a notch
      wheelRest -= notches * WHEEL_NOTCH_LINES;
      if (sendWheel(term, notches)) return;
      // The program would not take it after all; fall through.
    }

    if (term.buffer.active.type === 'alternate') {
      if (target === 'pagekeys' && tmuxScrollOn() && !tmuxCopy.active) {
        // Nothing sits below the live pane, so a downward drag has no work yet.
        if (lines >= 0) return;
        enterTmuxCopyMode(tab);
      }
      return sendPageKeys(tab, lines);
    }

    term.scrollLines(lines);
    noteScroll(term, lines);
    updateScrollButton();
  }

  function stopGlide() {
    if (touch.glide) cancelAnimationFrame(touch.glide);
    touch.glide = 0;
  }

  /** Keep scrolling after the finger leaves, decaying to a stop. */
  function startGlide() {
    // Inertia belongs to the scrollback; a program would only get a flood.
    if (!activeTab || scrollTarget(activeTab.term) !== 'scrollback') return;
    let v = Math.max(-3, Math.min(3, touch.velocity));
    if (Math.abs(v) < 0.005) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(48, now - last);
      last = now;
      v *= Math.pow(GLIDE_FRICTION, dt);
      if (!activeTab || Math.abs(v) < 0.002) { touch.glide = 0; return; }
      touch.rest += v * dt;
      const lines = Math.trunc(touch.rest);
      touch.rest -= lines;
      if (lines) {
        activeTab.term.scrollLines(lines);
        noteScroll(activeTab.term, lines);
        updateScrollButton();
      }
      touch.glide = requestAnimationFrame(step);
    };
    touch.glide = requestAnimationFrame(step);
  }

  /** Paint the selection from the long-press anchor to the cell under the finger. */
  function selectTo(term, cell) {
    let [ac, ar] = touch.anchor;
    let [cc, cr] = cell;
    // A selection is anchored at its start, so a backwards drag swaps the ends.
    if (cr < ar || (cr === ar && cc < ac)) [ac, ar, cc, cr] = [cc, cr, ac, ar];
    const length = (cr - ar) * term.cols + (cc - ac) + 1;
    term.select(ac, ar, Math.max(1, length));
  }

  /**
   * The wheel is the desktop half of the drag, and takes the same route through
   * `scrollLines` — xterm's own handler drives the viewport's DOM `scrollTop`,
   * which does nothing while that element is mid-resize.
   */
  function setupWheelScroll() {
    const wrap = $('termWrap');
    let rest = 0;
    wrap.addEventListener('wheel', (event) => {
      const tab = activeTab;
      if (!tab || event.ctrlKey) return; // ctrl+wheel is the browser's zoom

      const cell = cellSize(tab.term).h;
      let px = event.deltaY;
      if (event.deltaMode === 1) px *= cell;                 // reported in lines
      else if (event.deltaMode === 2) px *= cell * tab.term.rows; // in pages

      rest += px / cell;
      const lines = Math.trunc(rest);
      rest -= lines;
      diag.moves++;
      applyScroll(tab, lines);
      // Always swallowed: reaching xterm's own wheel handler is what sends the
      // arrow keys a TUI mistakes for navigation.
      event.preventDefault();
      event.stopPropagation();
    }, { capture: true, passive: false });
  }

  function setupTouchGestures() {
    const wrap = $('termWrap');

    wrap.addEventListener('touchstart', (event) => {
      stopGlide();
      clearTimeout(touch.holdTimer);
      // The floating buttons live inside the wrap; a tap on one is not a gesture.
      if (event.target.closest?.('button')) { touch.mode = 'idle'; return; }
      if (event.touches.length !== 1 || !activeTab) { touch.mode = 'idle'; return; }
      const t = event.touches[0];
      touch.mode = 'pending';
      touch.startX = t.clientX;
      touch.startY = t.clientY;
      touch.lastY = t.clientY;
      touch.lastT = event.timeStamp;
      touch.rest = 0;
      touch.velocity = 0;
      wheelRest = 0;
      altPageRest = 0;
      const x = t.clientX;
      const y = t.clientY;
      touch.holdTimer = setTimeout(() => {
        touch.holdTimer = 0;
        if (touch.mode !== 'pending' || !activeTab) return;
        touch.mode = 'select';
        touch.quietUntil = performance.now() + 600;
        touch.anchor = cellAt(activeTab.term, x, y);
        selectTo(activeTab.term, touch.anchor);
        haptic(25);
      }, LONG_PRESS_MS);
    }, { capture: true, passive: true });

    wrap.addEventListener('touchmove', (event) => {
      if (touch.mode === 'idle' || !activeTab) return;
      if (event.touches.length !== 1) {
        touch.mode = 'idle';
        clearTimeout(touch.holdTimer);
        return;
      }
      const t = event.touches[0];
      const term = activeTab.term;
      touch.quietUntil = performance.now() + 600;

      // A finger that has left the spot it landed on is scrolling, not holding.
      // Without this, starting a drag slowly — which is how a thumb scrolls a
      // phone — trips the long press and selects text instead.
      if (touch.mode === 'pending' && touch.holdTimer) {
        const drift = Math.hypot(t.clientX - touch.startX, t.clientY - touch.startY);
        if (drift > HOLD_SLOP) {
          clearTimeout(touch.holdTimer);
          touch.holdTimer = 0;
        }
      }

      if (touch.mode === 'select') {
        selectTo(term, cellAt(term, t.clientX, t.clientY));
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (touch.mode === 'pending') {
        const dx = t.clientX - touch.startX;
        const dy = t.clientY - touch.startY;
        // Sideways travel is not ours: leave it alone so a tap stays a tap.
        if (Math.abs(dy) < DRAG_THRESHOLD || Math.abs(dy) <= Math.abs(dx)) {
          touch.quietUntil = 0;
          return;
        }
        clearTimeout(touch.holdTimer);
        touch.mode = 'scroll';
        touch.lastY = t.clientY;
        touch.lastT = event.timeStamp;
        term.clearSelection();
      }

      // Dragging down uncovers older lines, so the sign is inverted.
      const moved = t.clientY - touch.lastY;
      const dt = Math.max(1, event.timeStamp - touch.lastT);
      const cell = cellSize(term).h;
      touch.velocity = -(moved / cell) / dt;
      touch.lastY = t.clientY;
      touch.lastT = event.timeStamp;

      diag.moves++;
      touch.rest += -moved / cell;
      const lines = Math.trunc(touch.rest);
      touch.rest -= lines;
      applyScroll(activeTab, lines);

      // xterm listens for touchmove as well; let it through and it scrolls twice.
      event.preventDefault();
      event.stopPropagation();
    }, { capture: true, passive: false });

    const finish = () => {
      clearTimeout(touch.holdTimer);
      if (touch.mode === 'scroll') {
        touch.quietUntil = performance.now() + 500;
        startGlide();
      } else if (touch.mode === 'select') {
        touch.quietUntil = performance.now() + 500;
      }
      touch.mode = 'idle';
    };
    wrap.addEventListener('touchend', finish, { capture: true });
    wrap.addEventListener('touchcancel', finish, { capture: true });
  }

  /* ------------------------------------------------------------ TerminalTab */

  class TerminalTab {
    constructor(opts = {}) {
      this.sid = opts.sid || null;
      this.name = opts.name || 'shell';
      this.customName = null;
      this.dead = false;
      this.socket = null;
      this.reconnectAttempt = 0;
      this.reconnectTimer = 0;
      this.decoder = new TextDecoder('utf-8', { fatal: false });
      this.encoder = new TextEncoder();
      this.pendingResize = 0;
      // Last size the pty was told. A redundant resize costs a SIGWINCH, and
      // the program answers it by repainting its whole screen.
      this.sentCols = 0;
      this.sentRows = 0;

      // Inactive tabs stay laid out (visibility, not display): xterm cannot
      // measure a cell inside a `display:none` box, and a tab opened that way
      // fits to a bogus column count.
      this.container = el('div');
      Object.assign(this.container.style, {
        position: 'absolute',
        inset: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
      });
      $('terminal').appendChild(this.container);

      const theme = currentTheme();
      this.term = new window.Terminal({
        fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
        fontSize: settings.fontSize,
        lineHeight: 1.15,
        letterSpacing: 0,
        cursorBlink: settings.cursorBlink,
        cursorStyle: 'block',
        // Focus lives on the IME composer, so the "unfocused" cursor is the one
        // actually on screen most of the time — keep it a solid block.
        cursorInactiveStyle: 'block',
        scrollback: 10000,
        theme: theme.xterm,
        allowProposedApi: true,
        allowTransparency: false,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        convertEol: false,
      });

      this.fit = new window.FitAddon.FitAddon();
      this.term.loadAddon(this.fit);
      try {
        this.term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
      } catch { /* optional */ }
      try {
        const unicode = new window.Unicode11Addon.Unicode11Addon();
        this.term.loadAddon(unicode);
        this.term.unicode.activeVersion = '11';
      } catch { /* optional */ }

      this.term.open(this.container);
      this.#loadRenderer();
      this.#hardenTextarea();

      this.term.onData((data) => {
        leaveTmuxCopyMode(this);
        this.send(applyMods(data));
      });
      this.term.onBinary((data) => {
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 255;
        this.sendBytes(bytes);
      });
      this.term.onTitleChange((title) => {
        this.title = title;
        if (activeTab === this) updateTopbar();
      });
      this.term.onBell(() => { if (settings.bell) haptic(30); });
      this.term.onSelectionChange(() => {
        if (activeTab === this) updateCopyButton();
      });
      this.term.onScroll(() => { if (activeTab === this) updateScrollButton(); });
    }

    #loadRenderer() {
      // Browsers cap live WebGL contexts (~16); past a handful of tabs the
      // canvas renderer is the safer choice.
      if (tabs.length >= 6) return this.#loadCanvas();
      // WebGL is the fastest but is unavailable/flaky on some mobile GPUs.
      try {
        const webgl = new window.WebglAddon.WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          this.#loadCanvas();
        });
        this.term.loadAddon(webgl);
        return;
      } catch { /* fall through */ }
      this.#loadCanvas();
    }

    #loadCanvas() {
      try {
        this.term.loadAddon(new window.CanvasAddon.CanvasAddon());
      } catch { /* DOM renderer is the built-in fallback */ }
    }

    /**
     * xterm hard-codes autocorrect/spellcheck off on its helper textarea. Gboard
     * reads that as "no composing region" and drops Vietnamese Telex back to raw
     * letters, so restore the IME-friendly defaults. The dedicated composer in
     * `ime` takes over on touch devices; this keeps the fallback path usable too.
     */
    #hardenTextarea() {
      const ta = this.term.textarea;
      if (!ta) return;
      ta.setAttribute('autocapitalize', 'none');
      ta.setAttribute('enterkeyhint', 'enter');
      ta.setAttribute('inputmode', 'text');
      ta.setAttribute('autocorrect', settings.suggestions ? 'on' : 'off');
      ta.setAttribute('spellcheck', settings.suggestions ? 'true' : 'false');
      if (settings.suggestions) ta.removeAttribute('autocomplete');
      else ta.setAttribute('autocomplete', 'off');
    }

    get label() {
      // A name the user set outranks the shell's own OSC title.
      return this.customName || this.title || this.name;
    }

    rename(name) {
      const clean = String(name ?? '').trim().slice(0, 48);
      if (!clean) return;
      this.customName = clean;
      this.name = clean;
      this.sendJSON({ t: 'rename', name: clean });
      if (this.sid) api(`/api/sessions/${this.sid}`, { method: 'PATCH', body: { name: clean } }).catch(() => {});
      if (activeTab === this) updateTopbar();
      renderTabs();
      persistTabs();
    }

    connect() {
      if (this.socket && (this.socket.readyState === 0 || this.socket.readyState === 1)) return;
      clearTimeout(this.reconnectTimer);

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams();
      if (this.sid) params.set('sid', this.sid);
      if (token) params.set('token', token);
      params.set('cols', String(this.term.cols));
      params.set('rows', String(this.term.rows));
      params.set('name', this.name);

      setStatus('connecting');
      const socket = new WebSocket(`${proto}//${location.host}${BASE}/ws?${params}`);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;

      socket.onopen = () => {
        this.reconnectAttempt = 0;
        setStatus('online');
        hideOverlay();
        this.sentCols = 0; // a new pty has not been told anything yet
        this.sentRows = 0;
        this.resize(true);
      };

      socket.onmessage = (event) => {
        if (typeof event.data === 'string') return this.#handleEvent(JSON.parse(event.data));
        this.term.write(this.decoder.decode(event.data, { stream: true }));
      };

      socket.onclose = (event) => {
        this.socket = null;
        if (activeTab === this) setStatus('offline');
        if (event.code === 4003 || event.code === 4029) {
          showOverlay('Không mở được phiên', event.reason || 'Máy chủ từ chối yêu cầu.');
          return;
        }
        if (this.dead) return;
        if (settings.autoReconnect) this.#scheduleReconnect();
        else if (activeTab === this) showOverlay('Mất kết nối', 'Nhấn để kết nối lại.');
      };

      socket.onerror = () => { /* onclose does the recovery */ };
    }

    #handleEvent(msg) {
      switch (msg.t) {
        case 'ready':
          this.sid = msg.session.id;
          this.name = msg.session.name;
          if (msg.session.renamed) this.customName = msg.session.name;
          this.serverPid = msg.session.pid;
          persistTabs();
          if (activeTab === this) updateTopbar();
          renderTabs();
          break;
        case 'renamed':
          this.customName = msg.name;
          this.name = msg.name;
          if (activeTab === this) updateTopbar();
          renderTabs();
          break;
        case 'exit':
          this.dead = true;
          this.term.write(`\r\n\x1b[90m[phiên kết thúc — mã ${msg.exitCode ?? '?'}]\x1b[0m\r\n`);
          renderTabs();
          if (activeTab === this) showOverlay('Phiên đã kết thúc', 'Shell đã thoát. Mở phiên mới để tiếp tục.');
          break;
        case 'error':
          if (msg.code === 'session_gone') {
            this.sid = null; // server will hand us a fresh pty on this same socket
            persistTabs();
          } else {
            toast(msg.message, 'error');
          }
          break;
        default:
          break;
      }
    }

    #scheduleReconnect() {
      this.reconnectAttempt++;
      const delay = Math.min(15000, 500 * 2 ** Math.min(this.reconnectAttempt, 5));
      if (activeTab === this) {
        showOverlay('Đang kết nối lại…', `Thử lại sau ${Math.round(delay / 1000)}s (lần ${this.reconnectAttempt}).`);
      }
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }

    send(text) {
      if (!text) return;
      this.sendBytes(this.encoder.encode(text));
    }

    sendBytes(bytes) {
      if (this.socket?.readyState === 1) this.socket.send(bytes);
    }

    sendJSON(obj) {
      if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(obj));
    }

    resize(immediate) {
      clearTimeout(this.pendingResize);
      const run = () => {
        // The soft keyboard opening is a resize, and xterm snaps the viewport
        // to the bottom when it reflows. Remember how far up the reader was so
        // the scrollback position survives the keyboard.
        const before = this.term.buffer.active;
        const fromBottom = before.type === 'normal' ? before.baseY - before.viewportY : 0;
        try { this.fit.fit(); } catch { return; }
        if (fromBottom > 0) {
          this.term.scrollToLine(Math.max(0, this.term.buffer.active.baseY - fromBottom));
        }
        const cols = this.term.cols;
        const rows = this.term.rows;
        if (cols !== this.sentCols || rows !== this.sentRows) {
          this.sentCols = cols;
          this.sentRows = rows;
          this.sendJSON({ t: 'resize', cols, rows });
        }
        if (activeTab === this) { updateTopbar(); updateScrollButton(); }
      };
      if (immediate) run();
      else this.pendingResize = setTimeout(run, 80);
    }

    show() {
      this.container.style.visibility = 'visible';
      this.container.style.pointerEvents = 'auto';
      // Fit after the browser has laid the container out, not before.
      requestAnimationFrame(() => this.resize(true));
      focusInput();
    }

    hide() {
      this.container.style.visibility = 'hidden';
      this.container.style.pointerEvents = 'none';
    }

    dispose() {
      this.dead = true;
      clearTimeout(this.reconnectTimer);
      try { this.socket?.close(1000, 'closed'); } catch { /* already closed */ }
      this.term.dispose();
      this.container.remove();
    }

    applySettings() {
      this.term.options.fontSize = settings.fontSize;
      this.term.options.cursorBlink = settings.cursorBlink;
      this.term.options.theme = currentTheme().xterm;
      this.resize(true);
    }
  }

  /* -------------------------------------------------------------- tab set */

  /** @type {TerminalTab[]} */
  const tabs = [];
  let activeTab = null;

  const TABS_KEY = 'wt.tabs.v2';

  /**
   * The server owns the session list; this only remembers presentation state —
   * the tab order the user arranged and which one was in front. Losing it (new
   * device, cleared storage, logout) must never lose a shell.
   */
  function persistTabs() {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({
        order: tabs.filter((t) => t.sid && !t.dead).map((t) => t.sid),
        active: activeTab?.sid ?? null,
      }));
    } catch { /* private mode */ }
  }

  function tabPreferences() {
    try {
      const raw = JSON.parse(localStorage.getItem(TABS_KEY) || '{}');
      return { order: Array.isArray(raw.order) ? raw.order : [], active: raw.active ?? null };
    } catch {
      return { order: [], active: null };
    }
  }

  function newTab(opts) {
    const tab = new TerminalTab(opts);
    tabs.push(tab);
    activate(tab);
    tab.connect();
    renderTabs();
    return tab;
  }

  function activate(tab) {
    if (activeTab === tab) return;
    leaveTmuxCopyMode();
    activeTab?.hide();
    activeTab = tab;
    tab.show();
    if (tab.socket?.readyState === 1) { setStatus('online'); hideOverlay(); }
    else if (tab.dead) showOverlay('Phiên đã kết thúc', 'Shell đã thoát. Mở phiên mới để tiếp tục.');
    else setStatus('connecting');
    updateTopbar();
    renderTabs();
    updateScrollButton();
    updateCopyButton();
    persistTabs();
  }

  function closeTab(tab) {
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    if (tab.sid) api(`/api/sessions/${tab.sid}`, { method: 'DELETE' }).catch(() => {});
    tab.dispose();
    tabs.splice(index, 1);
    persistTabs();
    if (activeTab === tab) {
      activeTab = null;
      if (tabs.length) activate(tabs[Math.max(0, index - 1)]);
      else newTab({});
    }
    renderTabs();
  }

  /* Press-and-hold state lives here, not in a per-node closure: renderTabs()
   * replaces the tab elements whenever a session reports in, and a closure-held
   * timer would die with the node it was attached to. */
  let hold = null;
  let holdFired = false;

  function beginHold(tab, event) {
    cancelHold();
    hold = {
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        hold = null;
        holdFired = true;
        haptic(25);
        promptRename(tab);
      }, 550),
    };
  }

  function cancelHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold = null;
  }

  /** True once, right after a hold fired, so the trailing click is swallowed. */
  function consumeHoldClick() {
    if (!holdFired) return false;
    holdFired = false;
    return true;
  }

  function bindHoldGestures() {
    const release = () => { cancelHold(); stopPress(); };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    // A soft keyboard opening, an alert, or a tab switch can swallow pointerup.
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    document.addEventListener('pointermove', (event) => {
      if (!hold) return;
      if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 12) cancelHold();
    }, true);
  }

  function bindReleaseSafety() {
    // Belt and braces: never let a repeat outlive the pointer that started it.
    document.addEventListener('pointerup', stopPress);
    document.addEventListener('touchend', stopPress);
    document.addEventListener('mouseup', stopPress);
  }

  function renderTabs() {
    const host = $('tabs');
    host.textContent = '';
    tabs.forEach((tab, i) => {
      const node = el('button', 'tab');
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(tab === activeTab));
      const dot = el('span', 'tab__dot');
      dot.dataset.dead = String(tab.dead);
      node.appendChild(dot);
      node.appendChild(el('span', 'tab__label', `${i + 1} ${tab.label}`));
      const close = el('span', 'tab__close', '✕');
      close.setAttribute('role', 'button');
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab); });
      node.appendChild(close);
      // Tap switches; press-and-hold renames — the phone-native gesture for it.
      node.addEventListener('pointerdown', (event) => beginHold(tab, event));
      node.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        cancelHold();
        promptRename(tab);
      });
      node.addEventListener('click', () => {
        if (consumeHoldClick()) return;
        activate(tab);
      });
      host.appendChild(node);
    });
    const selected = host.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ----------------------------------------------------------- topbar/UI */

  function setStatus(state) {
    $('statusDot').dataset.state = state;
  }

  function updateTopbar() {
    if (!activeTab) return;
    $('termTitle').textContent = activeTab.label;
    const size = `${activeTab.term.cols}×${activeTab.term.rows}`;
    const sid = activeTab.sid ? ` · ${activeTab.sid}` : '';
    $('termMeta').textContent = `${size}${sid}`;
  }

  function showOverlay(title, message) {
    $('overlayTitle').textContent = title;
    $('overlayMsg').textContent = message || '';
    $('overlay').hidden = false;
  }

  function hideOverlay() {
    $('overlay').hidden = true;
  }

  function updateScrollButton() {
    if (!activeTab) return;
    const buf = activeTab.term.buffer.active;
    const atBottom = buf.viewportY >= buf.baseY - 1;
    $('btnScrollBottom').hidden = atBottom;
  }

  /**
   * Copying is deliberate: the selection sits there until it is either copied
   * with this button or dismissed by a tap. Nothing reaches the clipboard on
   * its own, so selecting text just to read it no longer costs whatever the
   * clipboard was holding.
   */
  function updateCopyButton() {
    $('btnCopySel').hidden = !activeTab?.term.hasSelection();
  }

  /**
   * Last text copied from a terminal. `navigator.clipboard.readText` only
   * exists in a secure context, so over plain http the system clipboard is
   * write-only from here — this is what makes copy-then-paste-back work.
   */
  let lastCopied = '';

  /** Legacy copy path: the only one available without https. */
  function copyFallback(text) {
    const ta = el('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;';
    document.body.appendChild(ta);
    let ok = false;
    try {
      // iOS ignores select() on a readonly field; a range plus an explicit
      // selection range is the combination both engines honour.
      const range = document.createRange();
      range.selectNodeContents(ta);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
      sel.removeAllRanges();
    } catch { /* reported by the caller */ }
    ta.remove();
    return ok;
  }

  async function copyText(text, silent) {
    if (!text) return;
    lastCopied = text;
    try {
      await navigator.clipboard.writeText(text);
      if (!silent) toast('Đã chép', 'ok');
      return;
    } catch { /* no secure context, or permission refused */ }
    if (copyFallback(text)) {
      if (!silent) toast('Đã chép', 'ok');
    } else if (!silent) {
      // Still usable: the text is held in `lastCopied` for the paste key.
      toast('Đã chép (chỉ trong app)', 'ok');
    }
  }

  async function pasteText() {
    let text = '';
    try {
      text = (await navigator.clipboard.readText()) || '';
    } catch {
      text = lastCopied || prompt('Dán nội dung vào đây:') || '';
    }
    if (!text || !activeTab) return;
    // Through xterm rather than straight down the socket, so bracketed paste is
    // honoured: without it a pasted block of lines runs itself line by line.
    activeTab.term.paste(text);
  }

  /* -------------------------------------------------------------- keybar */

  const ACTIONS = {
    paste: pasteText,
    copy: () => copyText(activeTab?.term.getSelection() || ''),
    keyboard: () => toggleKeyboard(),
    clearSelection: () => activeTab?.term.clearSelection(),
    normalScreen: () => restoreNormalScreen(),
    scrollTop: () => activeTab?.term.scrollToTop(),
    scrollBottom: () => { leaveTmuxCopyMode(); activeTab?.term.scrollToBottom(); },
    fontUp: () => setFontSize(settings.fontSize + 1),
    fontDown: () => setFontSize(settings.fontSize - 1),
    newTab: () => newTab({}),
    settings: () => openSettings(),
    inputBar: () => {
      settings.inputBar = inputBarVisible() ? 'off' : 'on';
      saveSettings();
      applyInputBar();
      focusInput();
    },
  };

  function renderKeybarTabs() {
    const host = $('keybarTabs');
    host.textContent = '';
    for (const group of keyLayout) {
      const node = el('button', 'keybar__tab', group.label);
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(group.id === settings.keybarGroup));
      node.addEventListener('click', () => {
        settings.keybarGroup = group.id;
        saveSettings();
        renderKeybarTabs();
        renderKeyRows();
      });
      host.appendChild(node);
    }
  }

  function renderKeyRows() {
    const host = $('keybarRows');
    host.dataset.wrap = String(settings.wrapKeys);
    host.textContent = '';
    const group = keyLayout.find((g) => g.id === settings.keybarGroup) || keyLayout[0];
    if (!group) return;
    settings.keybarGroup = group.id;

    for (const key of group.keys) {
      const node = el('button', 'key', key.label);
      node.dataset.kind = key.kind;
      if (key.kind === 'mod') {
        node.dataset.active = String(mods[key.mod] || modLocks[key.mod]);
        node.dataset.locked = String(!!modLocks[key.mod]);
      }
      bindKey(node, key);
      host.appendChild(node);
    }
  }

  /* Like the tab long-press, key auto-repeat cannot live in a per-node closure:
   * firing a key clears the sticky modifiers, which re-renders the whole bar, and
   * the pointerup then lands on a fresh node — leaving the old node's interval
   * running forever. One press, tracked here, released from the document. */
  let press = null;

  function stopPress() {
    if (!press) return;
    clearTimeout(press.hold);
    clearInterval(press.repeat);
    press.node.dataset.pressed = 'false';
    press = null;
  }

  function bindKey(node, key) {
    const fire = () => {
      haptic();
      if (key.kind === 'mod') return toggleMod(key.mod);
      if (key.kind === 'action') return ACTIONS[key.action]?.();
      if (!activeTab) return;
      // A sticky modifier means the key is wanted as a control code, not text.
      if (inputBarVisible() && !mods.ctrl && !mods.alt && isPlainText(key.seq)) {
        return insertIntoBar(key.seq);
      }
      leaveTmuxCopyMode();
      // Multi-char sequences (arrows, macros) must not be ctrl-mangled.
      activeTab.send(key.seq.length === 1 ? applyMods(key.seq) : withAltPrefix(key.seq));
    };

    node.addEventListener('pointerdown', (event) => {
      event.preventDefault(); // keeps focus, and the soft keyboard, where it is
      stopPress();
      node.dataset.pressed = 'true';
      press = { node, hold: 0, repeat: 0 };
      fire();
      if (key.repeat && press) {
        press.hold = setTimeout(() => {
          if (press) press.repeat = setInterval(fire, 55);
        }, 380);
      }
    });
    node.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function withAltPrefix(seq) {
    let out = seq;
    if (mods.alt) out = '\x1b' + out;
    clearOneShotMods();
    return out;
  }

  function setKeybarVisible(visible) {
    settings.keybarVisible = visible;
    saveSettings();
    $('keybar').hidden = !visible;
    $('btnKeybar').setAttribute('aria-pressed', String(visible));
    activeTab?.resize(true);
  }

  function setFontSize(size) {
    settings.fontSize = Math.min(28, Math.max(8, size));
    saveSettings();
    $('fontValue').textContent = String(settings.fontSize);
    for (const tab of tabs) tab.applySettings();
  }

  /* ------------------------------------------------------ viewport sizing */

  let viewportH = 0;
  let viewportFrame = 0;
  let viewportSettle = 0;

  /**
   * Follow the visual viewport.
   *
   * iOS fires `resize` and `scroll` on it many times over while the soft
   * keyboard animates, so everything on that path has to be cheap: coalesce to
   * one frame, write the height only when it changed, and leave the expensive
   * half — reflowing xterm and resizing the pty — until the height stops
   * moving. Doing it per event was the lag: every pass refit the grid and sent
   * a resize, and each resize is a SIGWINCH the program answers with a full
   * repaint, mid-animation, over a phone connection.
   */
  function syncViewport() {
    if (viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      const vv = window.visualViewport;
      const height = Math.round(vv ? vv.height : window.innerHeight);

      if (height !== viewportH) {
        viewportH = height;
        document.documentElement.style.setProperty('--app-h', `${height}px`);
      }
      // The page slides out from under the keyboard on iOS; pin it back, but
      // only when it really moved — doing it every frame fights the browser's
      // own animation and is half of what feels like lag.
      if (window.scrollY !== 0) window.scrollTo(0, 0);

      clearTimeout(viewportSettle);
      viewportSettle = setTimeout(() => {
        // Only the tab on screen. A hidden one is refitted by show(), and
        // resizing it here would SIGWINCH a shell nobody is looking at.
        activeTab?.resize(true);
      }, 140);
    });
  }

  /* --------------------------------------------------------- admin panel */

  let panelTimer = 0;

  function openPanel() {
    $('panel').dataset.open = 'true';
    $('scrim').dataset.open = 'true';
    refreshPanel();
    clearInterval(panelTimer);
    panelTimer = setInterval(refreshPanel, 5000);
  }

  function closePanel() {
    $('panel').dataset.open = 'false';
    $('scrim').dataset.open = 'false';
    clearInterval(panelTimer);
  }

  async function refreshPanel() {
    try {
      const [info, list] = await Promise.all([api('/api/system'), api('/api/sessions')]);
      renderSysInfo(info);
      renderSessionList(list.sessions);
    } catch { /* panel is best-effort */ }
  }

  function meterRow(label, used, total) {
    const pct = total ? Math.min(100, (used / total) * 100) : 0;
    const row = el('div', 'row');
    const wrap = el('div', 'row__label');
    wrap.appendChild(el('span', null, label));
    const meter = el('div', 'meter');
    const fill = el('div', 'meter__fill');
    fill.style.width = `${pct}%`;
    fill.dataset.level = pct > 90 ? 'crit' : pct > 75 ? 'warn' : 'ok';
    meter.appendChild(fill);
    wrap.appendChild(meter);
    row.appendChild(wrap);
    row.appendChild(el('span', 'row__value', `${fmtBytes(used)} / ${fmtBytes(total)}`));
    return row;
  }

  function infoRow(label, value) {
    const row = el('div', 'row');
    row.appendChild(el('span', 'row__label', label));
    row.appendChild(el('span', 'row__value', value));
    return row;
  }

  function renderSysInfo(info) {
    const host = $('sysInfo');
    host.textContent = '';
    host.appendChild(infoRow('Hostname', info.hostname));
    host.appendChild(infoRow('Hệ điều hành', `${info.platform} (${info.arch})`));
    host.appendChild(infoRow('CPU', `${info.cpus} nhân`));
    host.appendChild(infoRow('Load', info.loadavg.map((n) => n.toFixed(2)).join(' ')));
    host.appendChild(infoRow('Uptime', fmtDuration(info.uptime)));
    host.appendChild(meterRow('RAM', info.memory.used, info.memory.total));
    if (info.disk) host.appendChild(meterRow('Ổ đĩa /', info.disk.used, info.disk.total));

    // Scroll diagnostics — read these right after dragging on the terminal.
    const term = activeTab?.term;
    if (term) {
      const buf = term.buffer.active;
      const cell = cellSize(term);
      host.appendChild(infoRow('Cuộn: đích', `${buf.type} → ${diag.mode}${tmuxCopy.active ? ' · tmux copy-mode' : ''}`));
      host.appendChild(infoRow('Cuộn: vị trí', `${buf.viewportY} / ${buf.baseY} · ${term.rows}×${term.cols}`));
      host.appendChild(infoRow('Cuộn: cell', `${cell.h.toFixed(1)}px`));
      host.appendChild(infoRow('Cuộn: chuột', `${term.modes.mouseTrackingMode} · ${diag.wheel} wheel`));
      host.appendChild(infoRow('Cuộn: đã nhận', `${diag.moves} move · ${diag.lines} dòng · ${diag.keys} phím`));
    }
  }

  function renderSessionList(list) {
    const host = $('sessionList');
    host.textContent = '';
    if (!list.length) {
      host.appendChild(el('p', 'hint', 'Chưa có phiên nào.'));
      return;
    }
    for (const s of list) {
      const item = el('div', 'session-item');
      const dot = el('span', 'tab__dot');
      dot.dataset.dead = String(s.exited);
      item.appendChild(dot);
      const meta = el('div', 'session-item__meta');
      meta.appendChild(el('span', null, s.title || s.name));
      meta.appendChild(el('small', null, `${s.id} · pid ${s.pid ?? '—'} · ${s.cols}×${s.rows} · ${s.clients} kết nối`));
      item.appendChild(meta);

      const rename = el('button', 'btn', '✎');
      rename.setAttribute('aria-label', 'Đổi tên phiên');
      rename.addEventListener('click', async () => {
        const name = await askText(s.name, 'vd: web-server');
        if (!name) return;
        const open = tabs.find((t) => t.sid === s.id);
        if (open) open.rename(name);
        else {
          try { await api(`/api/sessions/${s.id}`, { method: 'PATCH', body: { name } }); }
          catch (err) { return toast(err.message, 'error'); }
        }
        refreshPanel();
      });
      item.appendChild(rename);

      const attach = el('button', 'btn', 'Mở');
      attach.addEventListener('click', () => {
        const existing = tabs.find((t) => t.sid === s.id);
        if (existing) activate(existing);
        else newTab({ sid: s.id, name: s.name });
        closePanel();
      });
      item.appendChild(attach);

      const kill = el('button', 'btn btn--danger', '✕');
      kill.addEventListener('click', async () => {
        if (!confirm(`Kết thúc phiên ${s.id}?`)) return;
        try {
          await api(`/api/sessions/${s.id}`, { method: 'DELETE' });
          const open = tabs.find((t) => t.sid === s.id);
          if (open) closeTab(open);
          refreshPanel();
        } catch (err) { toast(err.message, 'error'); }
      });
      item.appendChild(kill);
      host.appendChild(item);
    }
  }

  /* ------------------------------------------------------ settings dialog */

  let editingLayout = null;
  let editingGroupId = null;

  function openSettings() {
    editingLayout = window.WTKeys.clone(keyLayout);
    editingGroupId = editingLayout.find((g) => g.id === settings.keybarGroup)?.id || editingLayout[0]?.id;
    $('fontValue').textContent = String(settings.fontSize);
    $('themeSelect').value = settings.theme;
    $('optCursorBlink').checked = settings.cursorBlink;
    $('optWrapKeys').checked = settings.wrapKeys;
    $('optHaptics').checked = settings.haptics;
    $('optTmuxScroll').value = settings.tmuxScroll;
    $('optAutoReconnect').checked = settings.autoReconnect;
    $('optBell').checked = settings.bell;
    $('optIme').checked = settings.imeMode;
    $('optPreedit').checked = settings.preedit;
    $('optSuggestions').checked = settings.suggestions;
    $('optInputBar').value = settings.inputBar;
    renderKeyGroupSelect();
    renderKeyEditor();
    $('settingsDialog').showModal();
  }

  function renderKeyGroupSelect() {
    const select = $('keyGroupSelect');
    select.textContent = '';
    for (const group of editingLayout) {
      const opt = el('option', null, group.label);
      opt.value = group.id;
      select.appendChild(opt);
    }
    select.value = editingGroupId;
  }

  function renderKeyEditor() {
    const host = $('keyEditor');
    host.textContent = '';
    const group = editingLayout.find((g) => g.id === editingGroupId);
    if (!group) return;

    group.keys.forEach((key, index) => {
      const row = el('div', 'keyedit');

      const label = el('input');
      label.className = 'keyedit__label';
      label.type = 'text';
      label.value = key.label;
      label.placeholder = 'Nhãn';
      label.addEventListener('input', () => { key.label = label.value; });
      row.appendChild(label);

      const seq = el('input');
      seq.type = 'text';
      seq.autocapitalize = 'none';
      seq.spellcheck = false;
      if (key.kind === 'mod') {
        seq.value = `modifier: ${key.mod}`;
        seq.disabled = true;
      } else if (key.kind === 'action') {
        seq.value = `action: ${key.action}`;
        seq.disabled = true;
      } else {
        seq.value = window.WTKeys.formatSequence(key.seq || '');
        seq.placeholder = 'Chuỗi gửi, vd \\e[A';
        seq.addEventListener('input', () => { key.seq = window.WTKeys.parseSequence(seq.value); });
      }
      row.appendChild(seq);

      const up = el('button', null, '↑');
      up.addEventListener('click', () => {
        if (index === 0) return;
        [group.keys[index - 1], group.keys[index]] = [group.keys[index], group.keys[index - 1]];
        renderKeyEditor();
      });
      row.appendChild(up);

      const del = el('button', null, '✕');
      del.addEventListener('click', () => { group.keys.splice(index, 1); renderKeyEditor(); });
      row.appendChild(del);

      host.appendChild(row);
    });
  }

  function commitSettings() {
    settings.theme = $('themeSelect').value;
    settings.cursorBlink = $('optCursorBlink').checked;
    settings.wrapKeys = $('optWrapKeys').checked;
    settings.haptics = $('optHaptics').checked;
    settings.tmuxScroll = $('optTmuxScroll').value;
    settings.autoReconnect = $('optAutoReconnect').checked;
    settings.bell = $('optBell').checked;
    settings.imeMode = $('optIme').checked;
    settings.preedit = $('optPreedit').checked;
    settings.suggestions = $('optSuggestions').checked;
    settings.inputBar = $('optInputBar').value;
    if (!settings.preedit) hidePreedit();
    saveSettings();
    applySuggestions();

    try {
      keyLayout = window.WTKeys.save(editingLayout);
    } catch (err) {
      toast(err.message, 'error');
      return false;
    }
    if (!keyLayout.some((g) => g.id === settings.keybarGroup)) settings.keybarGroup = keyLayout[0].id;

    applyChrome();
    for (const tab of tabs) tab.applySettings();
    renderKeybarTabs();
    renderKeyRows();
    applyInputBar();
    focusInput();
    return true;
  }

  function askText(value, placeholder) {
    return new Promise((resolve) => {
      const dialog = $('renameDialog');
      const input = $('renameInput');
      input.value = value || '';
      if (placeholder) input.placeholder = placeholder;
      const done = () => {
        dialog.removeEventListener('close', done);
        resolve(dialog.returnValue === 'ok' ? input.value.trim() : null);
      };
      dialog.addEventListener('close', done);
      dialog.showModal();
      setTimeout(() => { input.focus(); input.select(); }, 50);
    });
  }

  async function promptRename(tab) {
    const name = await askText(tab.customName || tab.name, 'vd: web-server');
    if (name) tab.rename(name);
    focusInput();
  }

  function openJSONDialog(title, value, hint, onOk) {
    $('jsonTitle').textContent = title;
    $('jsonArea').value = value;
    $('jsonHint').textContent = hint || '';
    const dialog = $('jsonDialog');
    $('btnJsonOk').onclick = () => {
      if (onOk && onOk($('jsonArea').value) === false) return;
      dialog.close();
    };
    $('btnJsonCancel').onclick = () => dialog.close();
    dialog.showModal();
  }

  /* ------------------------------------------------------------ wire-up */

  function bindUI() {
    setupIME();
    setupTouchGestures();
    setupWheelScroll();
    bindHoldGestures();
    bindReleaseSafety();
    $('btnMenu').addEventListener('click', openPanel);
    $('termTitle').addEventListener('click', () => { if (activeTab) promptRename(activeTab); });
    $('btnPanelClose').addEventListener('click', closePanel);
    $('scrim').addEventListener('click', closePanel);
    $('btnRefresh').addEventListener('click', refreshPanel);
    $('btnNewSession').addEventListener('click', () => { newTab({}); closePanel(); });

    $('btnLogout').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch { /* token may already be gone */ }
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      location.reload();
    });

    $('btnKeyboard').addEventListener('click', () => {
      focusInput();
      haptic();
    });
    $('btnKeybar').addEventListener('click', () => setKeybarVisible(!settings.keybarVisible));
    $('btnSettings').addEventListener('click', openSettings);
    $('btnNewTab').addEventListener('click', () => newTab({}));
    $('btnReconnect').addEventListener('click', () => {
      if (activeTab?.dead) return newTab({});
      activeTab.reconnectAttempt = 0;
      activeTab?.connect();
    });
    $('btnScrollBottom').addEventListener('click', () => {
      leaveTmuxCopyMode();
      activeTab?.term.scrollToBottom();
      updateScrollButton();
    });
    $('btnCopySel').addEventListener('click', () => {
      const text = activeTab?.term.getSelection();
      if (!text) return;
      copyText(text);
      haptic(15);
      activeTab.term.clearSelection();
      updateCopyButton();
    });

    $('btnSettingsClose').addEventListener('click', () => $('settingsDialog').close());
    $('btnSettingsSave').addEventListener('click', () => { if (commitSettings()) $('settingsDialog').close(); });
    $('fontUp').addEventListener('click', () => setFontSize(settings.fontSize + 1));
    $('fontDown').addEventListener('click', () => setFontSize(settings.fontSize - 1));
    $('themeSelect').addEventListener('change', () => {
      settings.theme = $('themeSelect').value;
      applyChrome();
      for (const tab of tabs) tab.applySettings();
    });

    $('keyGroupSelect').addEventListener('change', () => {
      editingGroupId = $('keyGroupSelect').value;
      renderKeyEditor();
    });
    $('btnKeyAdd').addEventListener('click', () => {
      const group = editingLayout.find((g) => g.id === editingGroupId);
      if (!group) return;
      group.keys.push({ id: `custom-${Date.now()}`, label: 'Key', kind: 'key', seq: '' });
      renderKeyEditor();
    });
    $('btnKeyGroupAdd').addEventListener('click', () => {
      const label = prompt('Tên nhóm phím:');
      if (!label) return;
      const id = `g-${Date.now()}`;
      editingLayout.push({ id, label, keys: [{ id: `${id}-0`, label: 'Key', kind: 'key', seq: '' }] });
      editingGroupId = id;
      renderKeyGroupSelect();
      renderKeyEditor();
    });
    $('btnKeyGroupDel').addEventListener('click', () => {
      if (editingLayout.length <= 1) return toast('Phải giữ ít nhất 1 nhóm', 'error');
      editingLayout = editingLayout.filter((g) => g.id !== editingGroupId);
      editingGroupId = editingLayout[0].id;
      renderKeyGroupSelect();
      renderKeyEditor();
    });
    $('btnKeyExport').addEventListener('click', () => {
      openJSONDialog('Xuất bố cục phím', JSON.stringify(editingLayout, null, 2), 'Sao chép để sao lưu hoặc dùng ở máy khác.', () => true);
    });
    $('btnKeyImport').addEventListener('click', () => {
      openJSONDialog('Nhập bố cục phím', '', 'Dán JSON đã xuất trước đó.', (text) => {
        try {
          const parsed = window.WTKeys.sanitize(JSON.parse(text));
          if (!parsed) throw new Error('JSON không hợp lệ');
          editingLayout = parsed;
          editingGroupId = parsed[0].id;
          renderKeyGroupSelect();
          renderKeyEditor();
          toast('Đã nhập bố cục', 'ok');
          return true;
        } catch (err) {
          toast(err.message, 'error');
          return false;
        }
      });
    });
    $('btnKeyReset').addEventListener('click', () => {
      if (!confirm('Khôi phục bố cục phím mặc định?')) return;
      editingLayout = window.WTKeys.clone(window.WTKeys.DEFAULT_LAYOUT);
      editingGroupId = editingLayout[0].id;
      renderKeyGroupSelect();
      renderKeyEditor();
    });

    $('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await api('/api/login', {
          method: 'POST',
          body: { username: $('loginUser').value, password: $('loginPass').value },
        });
        token = data.token;
        localStorage.setItem(TOKEN_KEY, token);
        $('login').hidden = true;
        boot();
      } catch {
        $('loginError').textContent = 'Sai tài khoản hoặc mật khẩu.';
        haptic(40);
      }
    });

    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', () => setTimeout(syncViewport, 250));
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      syncViewport();
      for (const tab of tabs) if (!tab.dead && !tab.socket && settings.autoReconnect) tab.connect();
    });
    window.addEventListener('beforeunload', persistTabs);
  }

  /* ----------------------------------------------------------------- boot */

  async function boot() {
    $('app').hidden = false;
    applyChrome();
    syncViewport();
    setKeybarVisible(settings.keybarVisible);
    applyInputBar();
    applySuggestions();
    renderKeybarTabs();
    renderKeyRows();

    let alive = [];
    try {
      const data = await api('/api/sessions');
      alive = data.sessions.filter((s) => !s.exited);
    } catch { /* fall through to a fresh session */ }

    if (!alive.length) {
      newTab({});
      return;
    }

    // Every live session gets a tab, whatever this browser remembers. Ones the
    // user had arranged keep their order; sessions opened elsewhere (another
    // device, the admin panel) are appended by age.
    const prefs = tabPreferences();
    const rank = new Map(prefs.order.map((sid, i) => [sid, i]));
    alive.sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
      const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
      return ra !== rb ? ra - rb : a.createdAt - b.createdAt;
    });

    for (const session of alive) tabs.push(new TerminalTab({ sid: session.id, name: session.name }));

    const wanted = tabs.find((t) => t.sid === prefs.active) || tabs[0];
    activate(wanted);
    for (const tab of tabs) tab.connect();
    renderTabs();
    persistTabs();

    const extra = alive.filter((s) => !rank.has(s.id)).length;
    toast(
      extra
        ? `Đã khôi phục ${alive.length} phiên (${extra} phiên mở từ nơi khác)`
        : `Đã khôi phục ${alive.length} phiên`,
      'ok'
    );
  }

  async function start() {
    bindUI();
    try {
      serverConfig = await api('/api/config');
    } catch { /* keep defaults */ }
    document.title = serverConfig.title || 'Web Terminal';
    $('loginTitle').textContent = serverConfig.title || 'Web Terminal';

    if (!serverConfig.authRequired) return boot();
    if (token) {
      try {
        await api('/api/sessions');
        return boot();
      } catch { /* token expired */ }
    }
    showLogin();
  }

  // Diagnostics hook: handy from the browser console and used by the UI tests.
  window.__wt = {
    get tabs() { return tabs; },
    get active() { return activeTab; },
    get settings() { return settings; },
    get keyLayout() { return keyLayout; },
    get platform() { return { IS_IOS, IS_SAFARI, inputBarVisible: inputBarVisible() }; },
    get scroll() {
      const term = activeTab?.term;
      if (!term) return null;
      const buf = term.buffer.active;
      return { ...diag, type: buf.type, viewportY: buf.viewportY, baseY: buf.baseY,
               rows: term.rows, cell: cellSize(term).h,
               mouse: term.modes.mouseTrackingMode, target: scrollTarget(term) };
    },
    submitBar,
    screen() {
      const buf = activeTab?.term.buffer.active;
      if (!buf) return '';
      const lines = [];
      for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
      return lines.join('\n');
    },
  };

  start();
})();

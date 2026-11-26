// The sharing code entry: one real <input>, drawn as eight boxes (four
// letters, a drawn dash, four digits). Screen readers and password managers
// see one text field; the boxes are a picture of its value, kept in step with
// it, and the input lies over them, its own text and caret invisible.
// - Typing: the first four take the code's letters (A to Z without I and O),
//   upper-cased; the last four digits only. Anything else is refused: the box
//   flashes and nothing changes. A dash or a space is passed over.
// - Backspace, Delete, the arrows, Home and End are the field's own.
// - Pasting (or dropping text): a code in any form fills it; a link goes to
//   the page (onLink); a piece of a code that fits where the caret is goes in
//   as typed; text with exactly one code in it gives that code; anything else
//   says "That isn't a code or a Dropgate link."
// - There's no Go: once all eight are in, however they got there, the code
//   goes (onGo). Enter sends a whole code again, after something stopped it.
// - The status line under the boxes says what's happening, or what went wrong.

const LETTER = 'A-HJ-NP-Z';
const PREFIX = new RegExp(`^(?:[${LETTER}]{0,4}|[${LETTER}]{4}[0-9]{0,4})$`);
const WHOLE = new RegExp(`^[${LETTER}]{4}[0-9]{4}$`);
const TYPED_CODE = new RegExp(`^([${LETTER}]{4})-?([0-9]{4})$`, 'i');
const CODE_IN_TEXT = new RegExp(`(?:^|[^A-Za-z0-9])([${LETTER}]{4})[-\\s]?([0-9]{4})(?![A-Za-z0-9])`, 'gi');
const A_LETTER = new RegExp(`^[${LETTER}]$`);
const LINK = /^https?:\/\/\S+$/i;
const LENGTH = 8;

export const NOT_A_CODE = "That isn't a code or a Dropgate link.";

/** Whether `value` is a whole code as the input holds it: eight characters, no dash. */
export function isWholeCode(value) {
  return WHOLE.test(value);
}

/** The code as people read it, with its dash: `ABCD-1234`. */
export function withDash(value) {
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

/**
 * What a paste (or dropped text) does, given the input's value and selection:
 * - `{ kind: 'code', value }`: the boxes take a whole code;
 * - `{ kind: 'piece', value, caret }`: a piece of a code, put in as typed;
 * - `{ kind: 'link', link }`: a link, for the page to open;
 * - `{ kind: 'refused' }`: none of these;
 * - `{ kind: 'nothing' }`: nothing pasted.
 */
export function readPaste(text, value, start, end) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return { kind: 'nothing' };
  const typed = TYPED_CODE.exec(trimmed.replace(/\s+/g, ''));
  if (typed) return { kind: 'code', value: (typed[1] + typed[2]).toUpperCase() };
  if (LINK.test(trimmed)) return { kind: 'link', link: trimmed };
  const piece = trimmed.replace(/[\s-]+/g, '').toUpperCase();
  const inserted = value.slice(0, start) + piece + value.slice(end);
  if (PREFIX.test(inserted)) return { kind: 'piece', value: inserted, caret: start + piece.length };
  const found = new Set([...trimmed.matchAll(CODE_IN_TEXT)].map((m) => (m[1] + m[2]).toUpperCase()));
  if (found.size === 1) return { kind: 'code', value: [...found][0] };
  return { kind: 'refused' };
}

/**
 * Draws the boxes for a value and selection. `refusedAt` is the box that
 * flashes for a refused key, or -1.
 */
export function paintCode(field, { value, start, end, focused, refusedAt = -1 }) {
  const collapsed = start === end;
  field.querySelectorAll('.code-cell').forEach((box, i) => {
    const ch = value[i] ?? '';
    if (box.textContent !== ch) box.textContent = ch;
    const right = i < 4 ? A_LETTER.test(ch) : /^[0-9]$/.test(ch);
    const caretHere = focused && collapsed && start === i;
    box.classList.toggle('is-filled', ch !== '');
    box.classList.toggle('is-wrong', ch !== '' && !right);
    box.classList.toggle('is-selected', focused && !collapsed && i >= start && i < end);
    box.classList.toggle('is-active', focused && collapsed && (start === i || (start >= LENGTH && i === LENGTH - 1)));
    box.classList.toggle('caret-in', caretHere && ch === '');
    box.classList.toggle('caret-before', caretHere && ch !== '');
    box.classList.toggle('caret-after', focused && collapsed && start >= LENGTH && i === LENGTH - 1);
    box.classList.toggle('is-refused', refusedAt === i);
  });
  field.classList.toggle('is-focused', focused);
}

/**
 * Shows a status under the boxes: `{ message, busy }` while something runs
 * (with a spinner), `{ message, error: true }` for what went wrong, or
 * nothing at all.
 */
export function paintStatus(root, { message = '', busy = false, error = false } = {}) {
  const line = root.querySelector('.code-status');
  const field = root.querySelector('.code-field');
  const input = field.querySelector('input');
  line.querySelector('.code-status-text').textContent = message;
  line.classList.toggle('is-busy', busy && Boolean(message));
  line.classList.toggle('is-error', error && Boolean(message));
  field.classList.toggle('is-invalid', error && Boolean(message));
  field.classList.toggle('is-busy', busy);
  if (error && message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
  input.readOnly = busy;
  root.classList.toggle('has-status', Boolean(message));
}

/**
 * Brings a code entry to life. `root` holds the field (`.code-field` with its
 * input and boxes) and the status line (`.code-status`). `onGo(code)` gets a
 * whole code, upper case with its dash, as soon as it's in; `onLink(link)` a
 * pasted link. Returns the entry's controls.
 */
export function mountCodeInput(root, { onGo, onLink }) {
  const field = root.querySelector('.code-field');
  const input = field.querySelector('input');
  let last = { value: input.value, start: 0, end: 0 };
  let refusedAt = -1;
  let refusedTimer = 0;
  let busy = false;
  let frame = 0;

  const focused = () => document.activeElement === input;
  const selection = () => ({ start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length });

  function paint() {
    frame = 0;
    const { start, end } = selection();
    if (focused()) last = { value: input.value, start, end };
    paintCode(field, { value: input.value, start, end, focused: focused(), refusedAt });
  }
  const repaint = () => { if (!frame) frame = requestAnimationFrame(paint); };

  function setStatus(status) {
    busy = Boolean(status?.busy);
    paintStatus(root, status ?? {});
  }

  function go() {
    if (!busy && isWholeCode(input.value)) onGo?.(withDash(input.value));
  }

  /** A new value, put in by the code: the old status goes, and a whole code goes at once. */
  function setValue(value, caret = value.length) {
    input.value = value;
    if (focused()) input.setSelectionRange(caret, caret);
    last = { value, start: caret, end: caret };
    setStatus(null);
    paint();
    go();
  }

  function refuse() {
    const { start } = selection();
    refusedAt = Math.min(start, LENGTH - 1);
    clearTimeout(refusedTimer);
    refusedTimer = setTimeout(() => { refusedAt = -1; repaint(); }, 300);
    repaint();
  }

  // A key typed, or text put in by the browser or a password manager: the
  // value it would make is checked first, and a refused one never lands.
  input.addEventListener('beforeinput', (event) => {
    // While it opens, nothing goes in: Chromium fires this even on a read-only input.
    if (busy) { event.preventDefault(); return; }
    if (event.inputType !== 'insertText' && event.inputType !== 'insertReplacementText') return;
    const data = event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
    const { start, end } = selection();
    const piece = data.replace(/[\s-]+/g, '').toUpperCase();
    event.preventDefault();
    // A dash or a space: the dash is drawn, so it's passed over.
    if (!piece) return;
    const typed = TYPED_CODE.exec(data.replace(/\s+/g, ''));
    const whole = typed && start === 0 && end === input.value.length;
    const next = whole ? (typed[1] + typed[2]).toUpperCase() : input.value.slice(0, start) + piece + input.value.slice(end);
    if (!PREFIX.test(next)) { refuse(); return; }
    setValue(next, whole ? LENGTH : start + piece.length);
  });

  // Whatever wasn't checked first (a keyboard's composition, a fill that
  // skipped beforeinput): taken if it makes a code or the start of one,
  // otherwise put back. Deleting is always the field's own.
  input.addEventListener('input', (event) => {
    const value = input.value;
    if (String(event.inputType || '').startsWith('delete')) {
      setStatus(null);
      paint();
      return;
    }
    const compact = value.replace(/[\s-]+/g, '').toUpperCase();
    if (PREFIX.test(compact)) {
      const { start } = selection();
      const removedBefore = start - value.slice(0, start).replace(/[\s-]+/g, '').length;
      setValue(compact, Math.min(compact.length, start - removedBefore));
      return;
    }
    input.value = last.value;
    if (focused()) input.setSelectionRange(last.start, last.end);
    refuse();
  });

  function takePasted(text) {
    if (busy) return;
    const { start, end } = selection();
    const read = readPaste(text, input.value, start, end);
    if (read.kind === 'nothing') return;
    if (read.kind === 'code') setValue(read.value);
    else if (read.kind === 'piece') setValue(read.value, read.caret);
    else if (read.kind === 'link') { setStatus(null); onLink?.(read.link); }
    else setStatus({ message: NOT_A_CODE, error: true });
  }

  input.addEventListener('paste', (event) => {
    event.preventDefault();
    takePasted(event.clipboardData?.getData('text/plain') || event.clipboardData?.getData('text') || '');
  });
  input.addEventListener('drop', (event) => {
    const text = event.dataTransfer?.getData('text/plain');
    if (text === undefined) return;
    event.preventDefault();
    input.focus();
    takePasted(text);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    go();
  });

  // A click puts the caret at the box clicked, not where the input's own
  // (invisible, narrower) text would.
  input.addEventListener('click', (event) => {
    if (input.selectionStart !== input.selectionEnd) return;
    const boxes = [...field.querySelectorAll('.code-cell')];
    let caret = boxes.findIndex((box) => event.clientX < box.getBoundingClientRect().right);
    if (caret === -1) caret = LENGTH;
    else {
      const rect = boxes[caret].getBoundingClientRect();
      if (boxes[caret].textContent && event.clientX > rect.left + rect.width / 2) caret += 1;
    }
    caret = Math.min(caret, input.value.length);
    input.setSelectionRange(caret, caret);
    repaint();
  });

  for (const type of ['focus', 'blur', 'select', 'keyup', 'keydown', 'mouseup']) input.addEventListener(type, repaint);
  document.addEventListener('selectionchange', () => { if (focused()) repaint(); });

  paint();

  return {
    /** Empties it, with no status. */
    clear() { input.value = ''; last = { value: '', start: 0, end: 0 }; setStatus(null); paint(); },
    /** `{ message, busy }` while something runs, `{ message, error: true }` for what went wrong, or null. */
    setStatus,
    focus() { input.focus(); },
    get value() { return input.value; },
  };
}

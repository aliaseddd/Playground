// What this browser view can do: save files, print, remember a session.
// Stronghold runs either as a standalone page (a file, localhost or any static host) or inside
// the Claude artifact viewer, which blocks print dialogs and direct downloads but can hand a
// file to the viewer through its `downloads` capability.

export const inClaudeViewer = typeof window !== 'undefined' && Boolean(window.claude && typeof window.claude.use === 'function');

export const FILE_MODE_NOTE =
  'Any other web page opened as a file in this browser can read what Stronghold stores here. Use this copy to try Stronghold. For real records, run npm start and open http://localhost:8080, which keeps them apart.';

// Lets one tab write at a time, so tabs never act on each other's out-of-date records.
// Where Web Locks are missing or refused, each write still checks the store's revision first.
let locksUsable = typeof navigator !== 'undefined' && Boolean(navigator.locks && navigator.locks.request);
export async function writeLock(fn) {
  if (!locksUsable) return fn();
  let ran = false;
  try {
    return await navigator.locks.request('stronghold-write', () => {
      ran = true;
      return fn();
    });
  } catch (e) {
    if (ran) throw e;
    locksUsable = false;
    return fn();
  }
}

let downloadsPromise = null;
function downloads() {
  if (!inClaudeViewer) return Promise.resolve(null);
  if (!downloadsPromise) downloadsPromise = window.claude.use('downloads').catch(() => null);
  return downloadsPromise;
}

// Offers a file to save. Resolves 'saved' or 'declined'; rejects with a readable Error.
export async function saveFile(filename, data, mime) {
  if (inClaudeViewer) {
    const dl = await downloads();
    if (!dl) throw new Error('Saving files is not available in this view of Stronghold.');
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      if (e && e.code === 'declined') return 'declined';
      throw new Error((e && e.message) || 'The file could not be saved.');
    }
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
}

// How a badge reaches paper in this view.
export const printing = inClaudeViewer
  ? {
      mode: 'file',
      note: 'This viewer cannot open a print dialog, so Print badge saves the badge as a page. Open the saved page and it prints.',
    }
  : { mode: 'dialog', note: null };

// Prints a complete HTML document. Called only after the visit is recorded, so a printer
// problem never undoes a sign-in (REQ_000_024).
export async function printDocument(htmlDoc, filename) {
  if (typeof window.__strongholdPrintHook === 'function') return window.__strongholdPrintHook(htmlDoc, filename);
  if (printing.mode === 'file') return saveFile(filename, htmlDoc, 'text/html');
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    frame.onload = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        resolve('printed');
      } catch {
        reject(new Error('The browser did not open the print dialog.'));
      } finally {
        setTimeout(() => frame.remove(), 60000);
      }
    };
    frame.srcdoc = htmlDoc;
    document.body.append(frame);
  });
}

// Session storage can be blocked; a session then lasts until the page is closed.
const memory = new Map();
export const sessionStore = {
  get(key) {
    try {
      const v = window.sessionStorage.getItem(key);
      return v === null ? memory.get(key) ?? null : JSON.parse(v);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* kept in memory only */
    }
  },
  remove(key) {
    memory.delete(key);
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* nothing stored */
    }
  },
};

// Small per-browser preferences, such as a dismissed tip.
export const prefs = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(`stronghold.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(`stronghold.${key}`, JSON.stringify(value));
    } catch {
      /* preference not kept */
    }
  },
};

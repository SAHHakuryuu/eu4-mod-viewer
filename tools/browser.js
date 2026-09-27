'use strict';
/*
 * browser.js -- a tiny Chrome DevTools Protocol client.
 *
 * Everything here talks to a Chrome/Edge instance started with
 * --remote-debugging-port=<port>. That flag is OFF by default, so a browser you
 * already have open cannot be driven: Chrome only accepts the flag at startup
 * (and since Chrome 136 refuses it for the default profile at all). So
 * tools/gh-login.js launches its own instance and works there.
 *
 * Two connection styles, and the difference matters:
 *
 *   attach(port)      -> the BROWSER endpoint (ws://.../devtools/browser/<id>).
 *                        Only browser-level domains work here (Target, Browser).
 *   attachToPage(port)-> the PAGE endpoint taken from /json/list, i.e. the tab's
 *                        own socket. Page/Runtime/DOM work here with no session
 *                        routing at all.
 *
 * Routing page domains through a flattened session on the browser socket did not
 * work on Chrome 153: the sessionId was ignored for domain methods and every
 * call answered "'Page.enable' wasn't found" from the browser domain. Talking to
 * the tab's own socket avoids the whole issue.
 *
 * Prerequisites: Node >= 22 (global WebSocket). No npm packages, ever.
 */

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findBrowser() {
  const fs = require('fs');
  for (const p of CHROME_PATHS) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 3000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Launch a debuggable browser and return { proc, port, profile, version }. */
async function launch(opts) {
  opts = opts || {};
  const exe = opts.exe || findBrowser();
  if (!exe) throw new Error('no Chrome/Edge found; pass one in opts.exe');

  const { spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');

  const port = opts.port || 9333;
  const profile =
    opts.profile ||
    path.join(os.tmpdir(), 'eu4mv-cdp-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(profile, { recursive: true });

  const args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints',
    '--window-size=1400,950'
  ];
  if (opts.extraArgs) args.push.apply(args, opts.extraArgs);
  args.push(opts.url || 'about:blank');

  // stdio:'ignore' -- this harness cannot pipe another process's stdio.
  const proc = spawn(exe, args, { detached: false, stdio: 'ignore' });

  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const v = await httpJson('http://127.0.0.1:' + port + '/json/version', 1500);
      if (v && v.webSocketDebuggerUrl) return { proc, port, profile, exe, version: v };
    } catch (_) {
      /* not up yet */
    }
  }
  throw new Error('browser did not expose a CDP endpoint on port ' + port);
}

/** Connect to the browser endpoint. await cdp.ready before using it. */
function attach(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  return (async () => {
    for (;;) {
      try {
        const v = await httpJson('http://127.0.0.1:' + port + '/json/version', 1500);
        if (v && v.webSocketDebuggerUrl) {
          const cdp = connect(v.webSocketDebuggerUrl);
          await cdp.ready;
          return cdp;
        }
      } catch (_) {
        /* keep trying */
      }
      if (Date.now() > deadline) throw new Error('no CDP endpoint on port ' + port);
      await sleep(250);
    }
  })();
}

/**
 * Connect straight to a tab and return the page API:
 *   goto(url) waitFor(expr,opts) evaluate(expr,opts) click(sel) type(sel,val)
 *   text(sel) screenshot(file) send(method,params) clickAt(x,y) press(key)
 */
async function attachToPage(port, opts) {
  opts = opts || {};
  const deadline = Date.now() + (opts.timeout || 20000);
  let target = null;
  while (!target) {
    const list = await httpJson('http://127.0.0.1:' + port + '/json/list', 2000).catch(() => null);
    const pages = ((list || []).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl) || []);
    target = pages.find((t) => (opts.match ? opts.match(t.url) : true)) || pages[0] || null;
    if (!target) {
      if (Date.now() > deadline) throw new Error('no page target on port ' + port);
      await sleep(300);
    }
  }

  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  const send = cdp.send;
  const evaluate = cdp.evaluate;
  const fs = require('fs');

  const page = {
    // /json/list calls it "id"; Target.getTargets calls the same thing
    // "targetId". Accept whichever we were handed.
    targetId: target.id || target.targetId,
    url: target.url,
    send,
    evaluate,
    on: cdp.on,

    async goto(url) {
      await send('Page.enable');
      const r = await send('Page.navigate', { url });
      if (r && r.errorText) throw new Error('navigation failed: ' + r.errorText);
      await page.waitFor('document.readyState === "complete"', { timeout: 45000 });
      return page.url = await evaluate('location.href');
    },

    async waitFor(expr, o) {
      o = o || {};
      const stop = Date.now() + (o.timeout || 30000);
      let last;
      for (;;) {
        try {
          last = await evaluate(expr, o);
          if (last) return last;
        } catch (e) {
          last = 'error: ' + e.message;
        }
        if (Date.now() > stop) {
          throw new Error(
            'waitFor timed out (' + (o.timeout || 30000) + 'ms): ' + expr +
            ' last=' + JSON.stringify(last)
          );
        }
        await sleep(o.poll || 300);
      }
    },

    async click(sel) {
      const r = await evaluate(
        '(function(){var n=document.querySelector(' + JSON.stringify(sel) + ');' +
          'if(!n)return "not found";n.scrollIntoView({block:"center"});n.click();return "ok";})()'
      );
      if (r !== 'ok') throw new Error('click(' + sel + '): ' + r);
      return r;
    },

    async type(sel, value) {
      const r = await evaluate(
        '(function(){var n=document.querySelector(' + JSON.stringify(sel) + ');' +
          'if(!n)return "not found";n.focus();n.value=' + JSON.stringify(value) + ';' +
          'n.dispatchEvent(new Event("input",{bubbles:true}));' +
          'n.dispatchEvent(new Event("change",{bubbles:true}));return "ok";})()'
      );
      if (r !== 'ok') throw new Error('type(' + sel + '): ' + r);
      return r;
    },

    /** Real mouse click at viewport coordinates -- needed for native controls. */
    async clickAt(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: 'left',
          clickCount: 1,
          buttons: type === 'mousePressed' ? 1 : 0
        });
        await sleep(60);
      }
      return 'ok';
    },

    async rect(sel) {
      return evaluate(
        '(function(){var n=document.querySelector(' + JSON.stringify(sel) + ');' +
          'if(!n)return null;n.scrollIntoView({block:"center"});' +
          'var r=n.getBoundingClientRect();' +
          'return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()'
      );
    },

    async press(key, modifiers) {
      const common = { key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 0, modifiers: modifiers || 0 };
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, common));
      await send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, common));
      return 'ok';
    },

    async text(sel) {
      return evaluate(
        '(function(){var n=' +
          (sel ? 'document.querySelector(' + JSON.stringify(sel) + ')' : 'document.body') +
          ';return n?n.innerText.slice(0,4000):null;})()'
      );
    },

    async screenshot(file) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    }
  };

  page.close = () => cdp.close();
  return page;
}

function connect(wsUrl) {
  const pending = new Map();
  const listeners = [];
  let nextId = 1;
  let closed = false;

  const ws = new WebSocket(wsUrl);
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () =>
      reject(new Error('websocket error connecting to ' + wsUrl))
    );
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (const fn of listeners.slice()) {
        try {
          fn(msg);
        } catch (_) {
          /* a bad listener must not break the socket */
        }
      }
    }
  });

  ws.addEventListener('close', () => {
    closed = true;
    for (const p of pending.values()) p.reject(new Error('CDP socket closed'));
    pending.clear();
  });

  function send(method, params) {
    return new Promise((resolve, reject) => {
      if (closed) return reject(new Error('CDP socket closed'));
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  function on(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  // Serialised evaluate: each call is a self-contained function invocation, so
  // nothing depends on state from a previous call.
  let queue = Promise.resolve();
  function evaluate(expression, opts2) {
    const run = async () => {
      await ready;
      const r = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: !!(opts2 && opts2.awaitPromise),
        userGesture: !!(opts2 && opts2.userGesture)
      });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('page exception: ' + ((d.exception && d.exception.description) || d.text));
      }
      return r.result ? r.result.value : undefined;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  return { send, on, evaluate, ready, close: () => ws.close() };
}

/** Read the OS clipboard through a page that is on a github.com origin. */
async function readClipboard(page) {
  const v = await page.evaluate('navigator.clipboard.readText().then(t=>t,"no-clipboard")', {
    awaitPromise: true
  });
  return typeof v === 'string' ? v.trim() : '';
}

module.exports = {
  findBrowser,
  launch,
  attach,
  attachToPage,
  connect,
  readClipboard,
  sleep,
  httpJson
};

'use strict';
/**
 * Console launcher for the EU4 Mod Viewer.
 *
 * Started by `启动.bat` / `start.bat`. Keeping every human-readable line in
 * Node — rather than in the batch file — is deliberate: a `.bat` is read by
 * cmd.exe in the OEM code page, so CJK text inside one is fragile, while Node
 * writes UTF-8 that a `chcp 65001` console renders correctly. It also means the
 * launcher follows the same language setting as the web UI.
 *
 * Usage:
 *   node tools/launcher.js [--lang zh|en] [--port N] [--host H] [--no-open] [--help]
 */

const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const config = require(path.join(ROOT, 'src', 'config.js'));
const i18n = require(path.join(ROOT, 'src', 'i18n.js'));

const NL = process.platform === 'win32' ? '\r\n' : '\n';

/** Width of the label gutter in the startup banner (fits "Offline Chinese wiki"). */
const LABEL_W = 20;

const TEXT = {
  title: i18n.L('EU4 模组浏览器', 'EU4 Mod Viewer'),
  subtitle: i18n.L('Europa Universalis IV Mod Viewer', 'Europa Universalis IV Mod Viewer'),
  modsDir: i18n.L('模组目录', 'Mod folder'),
  gameDir: i18n.L('游戏目录', 'Game folder'),
  offlineWiki: i18n.L('离线中文 wiki', 'Offline Chinese wiki'),
  onlineWiki: i18n.L('英文在线 wiki', 'English online wiki'),
  language: i18n.L('界面语言', 'UI language'),
  url: i18n.L('访问地址', 'URL'),
  openHint: i18n.L('浏览器会自动打开；若未打开请手动访问上面的地址。',
    'The browser opens automatically; if it does not, open the URL above.'),
  stopHint: i18n.L('关闭此窗口即可停止服务。', 'Close this window to stop the server.'),
  settingsHint: i18n.L('语言与 wiki 设置在网页右上角的「设置」中修改。',
    'Change the language and wiki settings from Settings in the web UI.'),
  modsFound: i18n.L('发现 {n} 个模组', '{n} mods found'),
  pages: i18n.L('{n} 个页面', '{n} pages'),
  disabled: i18n.L('已禁用', 'disabled'),
  notFound: i18n.L('未找到', 'not found'),
  scanning: i18n.L('正在扫描模组，请稍候…', 'Scanning mods, please wait…'),
  alreadyRunning: i18n.L('检测到本程序已在运行，正在为你打开浏览器。',
    'The viewer is already running — opening it in your browser.'),
  portBusy: i18n.L('端口 {from} 已被其他程序占用，改用端口 {to}。',
    'Port {from} is in use by another program; using port {to} instead.'),
  noFreePort: i18n.L('在 {from} 到 {to} 之间找不到可用端口。',
    'No free port between {from} and {to}.'),
  failed: i18n.L('启动失败：{msg}', 'Startup failed: {msg}'),
  stopping: i18n.L('服务已停止。', 'Server stopped.'),
  help: i18n.L(
    '用法: node tools/launcher.js [选项]\n' +
    '  --lang zh|en   界面语言（同时决定控制台输出语言）\n' +
    '  --port N       监听端口（默认 4173）\n' +
    '  --host H       监听地址（默认 127.0.0.1）\n' +
    '  --no-open      启动后不自动打开浏览器\n' +
    '  --help         显示本帮助',
    'Usage: node tools/launcher.js [options]\n' +
    '  --lang zh|en   UI language (also selects the console language)\n' +
    '  --port N       listen port (default 4173)\n' +
    '  --host H       listen address (default 127.0.0.1)\n' +
    '  --no-open      do not open the browser on startup\n' +
    '  --help         show this help',
  ),
};

function parseArgs(argv) {
  const opts = { openBrowser: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang' || a === '-l') opts.lang = argv[++i];
    else if (a === '--port' || a === '-p') opts.port = Number(argv[++i]);
    else if (a === '--host') opts.host = argv[++i];
    else if (a === '--no-open') opts.openBrowser = false;
    else if (a === '--open') opts.openBrowser = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

/** Is something listening on this port? */
function probePort(port, host) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (busy) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(busy);
    };
    sock.setTimeout(700);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** Ask an already-listening port whether it is *our* server. */
function probeOurs(port, host) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/api/status', timeout: 1200 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 4096) body += d; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve(Boolean(j && j.ok === true && Array.isArray(j.errors)));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

/** Line a label up in a fixed-width gutter so the banner reads as a block. */
function row(label, value, width) {
  const pad = label + ' '.repeat(Math.max(1, width - label.length));
  return '  ' + pad + ': ' + value;
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const cfg = config.get();
  const lang = i18n.normalizeLang(argv.lang || cfg.language);
  const T = (pair, vars) => {
    let s = i18n.pick(pair, lang);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
    return s;
  };

  if (argv.help) {
    process.stdout.write(T(TEXT.help) + NL);
    return 0;
  }

  const host = argv.host || process.env.HOST || '127.0.0.1';
  const wanted = Number.isFinite(argv.port) && argv.port > 0 ? argv.port : (cfg.server.port || 4173);
  const shouldOpen = argv.openBrowser === null ? cfg.server.openBrowser !== false : argv.openBrowser;

  const line = '='.repeat(66);
  process.stdout.write(NL + line + NL);
  process.stdout.write('  ' + T(TEXT.title) + '  —  ' + T(TEXT.subtitle) + NL);
  process.stdout.write(line + NL + NL);

  // If our own server already owns the port, just surface it.
  if (await probePort(wanted, host)) {
    if (await probeOurs(wanted, host)) {
      const url = `http://${host}:${wanted}`;
      process.stdout.write('  ' + T(TEXT.alreadyRunning) + NL);
      process.stdout.write(row(T(TEXT.url), url, LABEL_W) + NL + NL);
      if (shouldOpen) openBrowser(url);
      return 0;
    }
  }

  // Find a free port, preferring the configured one.
  let port = wanted;
  let chosen = false;
  for (let p = wanted; p < wanted + 25; p++) {
    if (!(await probePort(p, host))) { port = p; chosen = true; break; }
  }
  if (!chosen) {
    process.stdout.write('  ' + T(TEXT.noFreePort, { from: wanted, to: wanted + 24 }) + NL + NL);
    return 1;
  }
  if (port !== wanted) process.stdout.write('  ' + T(TEXT.portBusy, { from: wanted, to: port }) + NL + NL);

  process.stdout.write('  ' + T(TEXT.scanning) + NL + NL);

  let started;
  try {
    const server = require(path.join(ROOT, 'src', 'server.js'));
    started = await server.start({ port, host, lang });
  } catch (e) {
    process.stdout.write('  ' + T(TEXT.failed, { msg: e && e.message ? e.message : String(e) }) + NL + NL);
    return 1;
  }

  const info = started.info || {};
  const url = started.url || `http://${host}:${port}`;
  const W = LABEL_W;
  // Values line up in one column; wrapped facts use the same indent.
  const cont = '  ' + ' '.repeat(W + 2);
  if (info.userDir) process.stdout.write(row(T(TEXT.modsDir), info.userDir, W) + NL);
  process.stdout.write(cont + T(TEXT.modsFound, { n: info.modCount || 0 }) + NL);
  if (info.installDir) process.stdout.write(row(T(TEXT.gameDir), info.installDir, W) + NL);
  else process.stdout.write(row(T(TEXT.gameDir), T(TEXT.notFound), W) + NL);

  if (info.wiki && info.wiki.enabled) {
    process.stdout.write(row(T(TEXT.offlineWiki), `${info.wiki.root}  (${T(TEXT.pages, { n: info.wiki.pageCount })})`, W) + NL);
  } else {
    process.stdout.write(row(T(TEXT.offlineWiki), T(TEXT.disabled), W) + NL);
  }
  if (info.wiki && info.wiki.online && info.wiki.online.enabled) {
    process.stdout.write(row(T(TEXT.onlineWiki), info.wiki.online.base, W) + NL);
  } else {
    process.stdout.write(row(T(TEXT.onlineWiki), T(TEXT.disabled), W) + NL);
  }
  process.stdout.write(row(T(TEXT.language), i18n.pick(i18n.LANG_LABELS[lang], lang), W) + NL);

  process.stdout.write(NL + line + NL);
  process.stdout.write('  ' + T(TEXT.url) + ' : ' + url + NL);
  process.stdout.write(line + NL);
  process.stdout.write('  ' + T(TEXT.openHint) + NL);
  process.stdout.write('  ' + T(TEXT.settingsHint) + NL);
  process.stdout.write('  ' + T(TEXT.stopHint) + NL + NL);

  if (shouldOpen) openBrowser(url);

  // Keep the process alive until the server closes (Ctrl+C or window close).
  return await new Promise((resolve) => {
    const bye = () => {
      process.stdout.write(NL + '  ' + T(TEXT.stopping) + NL);
      resolve(0);
    };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  });
}

if (require.main === module) {
  main().then(
    // Always exit explicitly: on the failure path a listening socket may still
    // be open, and simply setting exitCode would leave the process (and the
    // port) alive with nothing driving it.
    (code) => process.exit(code || 0),
    (e) => {
      process.stderr.write('launcher failed: ' + (e && e.stack ? e.stack : e) + NL);
      process.exit(1);
    },
  );
}

module.exports = { main, parseArgs, probePort, probeOurs, openBrowser };

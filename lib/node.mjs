import fs from 'node:fs';
import path from 'node:path';
import { run } from './proc.mjs';

export const MIN_NODE_MAJOR = 22;
const FALLBACK_VERSION = '22.20.0';

const INDEX_URLS = [
  'https://nodejs.org/dist/index.json',
  'https://npmmirror.com/mirrors/node/index.json',
  'https://cdn.npmmirror.com/binaries/node/index.json',
];

function emit(onEvent, payload) {
  if (typeof onEvent === 'function') onEvent({ ts: new Date().toISOString(), ...payload });
}

export function nodeMajor(version) {
  const v = String(version || process.versions.node).replace(/^v/i, '');
  return Number(v.split('.')[0]) || 0;
}

export function currentNodeInfo() {
  const version = process.versions.node;
  const major = nodeMajor(version);
  return {
    version,
    major,
    min: MIN_NODE_MAJOR,
    ok: major >= MIN_NODE_MAJOR,
    execPath: process.execPath,
  };
}

function compareVer(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => Number(n) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function platformSpec() {
  const plat = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (plat === 'win32') {
    return {
      arch,
      kind: 'zip',
      folder: (ver) => 'node-v' + ver + '-win-' + arch,
      file: (ver) => 'node-v' + ver + '-win-' + arch + '.zip',
      binRel: 'node.exe',
    };
  }
  const osName = plat === 'darwin' ? 'darwin' : 'linux';
  return {
    arch,
    kind: 'tar.gz',
    folder: (ver) => 'node-v' + ver + '-' + osName + '-' + arch,
    file: (ver) => 'node-v' + ver + '-' + osName + '-' + arch + '.tar.gz',
    binRel: path.join('bin', 'node'),
  };
}

function distUrls(version, filename) {
  const v = 'v' + version;
  return [
    'https://nodejs.org/dist/' + v + '/' + filename,
    'https://npmmirror.com/mirrors/node/' + v + '/' + filename,
    'https://cdn.npmmirror.com/binaries/node/' + v + '/' + filename,
  ];
}

async function fetchJson(url, timeout) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout || 20000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

async function resolveVersion(onEvent) {
  for (const url of INDEX_URLS) {
    try {
      emit(onEvent, { step: 'node', status: 'log', message: 'Query Node index ' + url });
      const list = await fetchJson(url, 20000);
      if (!Array.isArray(list)) continue;
      const v22 = list.filter((x) => x && /^v22\./.test(String(x.version || '')));
      const lts = v22.filter((x) => x.lts);
      const pool = (lts.length ? lts : v22).slice();
      pool.sort((a, b) => compareVer(a.version, b.version));
      const picked = pool[pool.length - 1];
      if (picked && picked.version) {
        const ver = String(picked.version).replace(/^v/i, '');
        emit(onEvent, { step: 'node', status: 'log', message: 'Use Node ' + ver + (picked.lts ? ' (LTS ' + picked.lts + ')' : '') });
        return ver;
      }
    } catch (e) {
      emit(onEvent, { step: 'node', status: 'warn', message: 'index failed: ' + e.message });
    }
  }
  emit(onEvent, { step: 'node', status: 'warn', message: 'Fall back to Node ' + FALLBACK_VERSION });
  return FALLBACK_VERSION;
}

function findNodeBin(rootDir) {
  const spec = platformSpec();
  const direct = path.join(rootDir, spec.binRel);
  if (fs.existsSync(direct)) return direct;
  const want = process.platform === 'win32' ? 'node.exe' : 'node';
  const stack = [rootDir];
  for (let i = 0; i < stack.length; i++) {
    const dir = stack[i];
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (n === 'node_modules') continue;
      const p = path.join(dir, n);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isFile() && n === want) {
        if (process.platform === 'win32') return p;
        if (path.basename(dir) === 'bin') return p;
      }
      if (st.isDirectory()) {
        const depth = path.relative(rootDir, p).split(path.sep).filter(Boolean).length;
        if (depth <= 3) stack.push(p);
      }
    }
  }
  return null;
}

export function findNpmCli(nodeExecPath) {
  const dir = path.dirname(nodeExecPath);
  const candidates = [
    path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(dir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function readNodeVersion(execPath) {
  const out = await run(execPath, ['-p', 'process.versions.node'], { timeout: 15000 });
  return String(out.stdout || '').trim();
}

async function downloadFile(url, dest, onEvent) {
  emit(onEvent, { step: 'node', status: 'run', message: 'Download ' + url });
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024 * 1024) throw new Error('Node archive too small (' + buf.length + ' bytes)');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function extractArchive(archive, dest, onEvent) {
  fs.mkdirSync(dest, { recursive: true });
  try {
    await run('tar', ['-xf', archive, '-C', dest], { timeout: 120000 });
    return;
  } catch (e) {
    emit(onEvent, { step: 'node', status: 'log', message: 'tar failed, try Expand-Archive' });
    if (process.platform !== 'win32') throw e;
    await run(
      'powershell',
      ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath "' + archive + '" -DestinationPath "' + dest + '" -Force'],
      { timeout: 120000 }
    );
  }
}

function toolsNodeDir(root) {
  return path.join(root, 'work', 'tools', 'node');
}

export async function ensureNode(root, onEvent) {
  const info = currentNodeInfo();
  if (info.ok) {
    emit(onEvent, { step: 'node', status: 'ok', message: 'Node ' + info.version + ' (>= ' + MIN_NODE_MAJOR + ')' });
    return {
      ...info,
      npmCli: findNpmCli(info.execPath),
      upgraded: false,
    };
  }

  emit(onEvent, {
    step: 'node',
    status: 'run',
    message: 'Current Node ' + info.version + ' < ' + MIN_NODE_MAJOR + ', installing portable Node ' + MIN_NODE_MAJOR,
  });

  const home = toolsNodeDir(root);
  fs.mkdirSync(home, { recursive: true });
  const existing = findNodeBin(home);
  if (existing) {
    try {
      const ver = await readNodeVersion(existing);
      if (nodeMajor(ver) >= MIN_NODE_MAJOR) {
        emit(onEvent, { step: 'node', status: 'ok', message: 'Reuse portable Node ' + ver });
        return {
          version: ver,
          major: nodeMajor(ver),
          min: MIN_NODE_MAJOR,
          ok: true,
          execPath: existing,
          npmCli: findNpmCli(existing),
          upgraded: true,
        };
      }
    } catch (e) {
      emit(onEvent, { step: 'node', status: 'warn', message: 'Portable Node broken, re-download: ' + e.message });
    }
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(home, { recursive: true });
  }

  const spec = platformSpec();
  const version = await resolveVersion(onEvent);
  const filename = spec.file(version);
  const archive = path.join(root, 'work', 'tools', filename);
  const unpack = path.join(root, 'work', 'tools', 'node-unpack-' + Date.now());
  let lastErr = null;
  for (const url of distUrls(version, filename)) {
    try {
      await downloadFile(url, archive, onEvent);
      fs.mkdirSync(unpack, { recursive: true });
      await extractArchive(archive, unpack, onEvent);
      const unpackedBin = findNodeBin(unpack);
      if (!unpackedBin) throw new Error('archive missing node binary');
      fs.mkdirSync(home, { recursive: true });
      const names = fs.readdirSync(unpack);
      const top = names.length === 1 ? path.join(unpack, names[0]) : unpack;
      fs.cpSync(top, home, { recursive: true });
      try { fs.rmSync(unpack, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(archive); } catch {}
      const bin = findNodeBin(home);
      if (!bin) throw new Error('portable node missing after extract');
      const ver = await readNodeVersion(bin);
      if (nodeMajor(ver) < MIN_NODE_MAJOR) throw new Error('downloaded Node ' + ver + ' still < ' + MIN_NODE_MAJOR);
      emit(onEvent, { step: 'node', status: 'ok', message: 'Installed portable Node ' + ver });
      return {
        version: ver,
        major: nodeMajor(ver),
        min: MIN_NODE_MAJOR,
        ok: true,
        execPath: bin,
        npmCli: findNpmCli(bin),
        upgraded: true,
      };
    } catch (e) {
      lastErr = e;
      emit(onEvent, { step: 'node', status: 'warn', message: 'Node download failed: ' + e.message });
      try { fs.rmSync(unpack, { recursive: true, force: true }); } catch {}
    }
  }
  throw new Error('无法自动安装 Node.js ' + MIN_NODE_MAJOR + '+：' + (lastErr && lastErr.message ? lastErr.message : 'unknown'));
}

export async function relaunchIfNeeded(root, argv, selfFile) {
  if (process.env.SKYMAIL_USING_NODE === '1') return false;
  if (nodeMajor() >= MIN_NODE_MAJOR) return false;
  const log = (evt) => {
    const line = '[' + (evt.step || 'node') + '] ' + (evt.status || '') + ' ' + (evt.message || '');
    process.stdout.write(line.trim() + '\n');
  };
  const node = await ensureNode(root, log);
  if (!node.execPath) throw new Error('No Node ' + MIN_NODE_MAJOR + '+ executable');
  if (path.resolve(node.execPath) === path.resolve(process.execPath)) return false;
  process.stdout.write('Restarting wizard with Node ' + node.version + '\n');
  const nodeDir = path.dirname(node.execPath);
  const env = Object.assign({}, process.env, {
    SKYMAIL_USING_NODE: '1',
    PATH: nodeDir + path.delimiter + (process.env.PATH || ''),
  });
  const { spawn } = await import('node:child_process');
  const code = await new Promise((resolve, reject) => {
    const child = spawn(node.execPath, [selfFile, ...argv], {
      stdio: 'inherit',
      env,
      windowsHide: false,
    });
    child.on('error', reject);
    child.on('exit', (c) => resolve(c == null ? 1 : c));
  });
  process.exit(code);
}

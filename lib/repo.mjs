import fs from 'node:fs';
import path from 'node:path';
import { commandExists, run } from './proc.mjs';

export const REPO_URL = 'https://github.com/maillab/cloud-mail.git';

const GIT_URLS = [
  'https://github.com/maillab/cloud-mail.git',
  'https://kkgithub.com/maillab/cloud-mail.git',
  'https://bgithub.xyz/maillab/cloud-mail.git',
  'https://gitclone.com/github.com/maillab/cloud-mail.git',
  'https://ghfast.top/https://github.com/maillab/cloud-mail.git',
  'https://mirror.ghproxy.com/https://github.com/maillab/cloud-mail.git',
  'https://ghproxy.net/https://github.com/maillab/cloud-mail.git',
];

const ZIP_URLS = [
  'https://codeload.github.com/maillab/cloud-mail/zip/refs/heads/main',
  'https://github.com/maillab/cloud-mail/archive/refs/heads/main.zip',
  'https://kkgithub.com/maillab/cloud-mail/archive/refs/heads/main.zip',
  'https://ghfast.top/https://github.com/maillab/cloud-mail/archive/refs/heads/main.zip',
  'https://mirror.ghproxy.com/https://github.com/maillab/cloud-mail/archive/refs/heads/main.zip',
  'https://ghproxy.net/https://github.com/maillab/cloud-mail/archive/refs/heads/main.zip',
  'https://gitdl.cn/https://github.com/maillab/cloud-mail/archive/refs/heads/main.zip',
];

function emit(onEvent, payload) {
  if (typeof onEvent === 'function') onEvent({ ts: new Date().toISOString(), ...payload });
}

function looksLikeRepo(dir) {
  try {
    return fs.existsSync(path.join(dir, 'mail-worker')) && fs.existsSync(path.join(dir, 'mail-vue'));
  } catch {
    return false;
  }
}

function findMailRepo(root) {
  const stack = [root];
  for (let i = 0; i < stack.length; i++) {
    const dir = stack[i];
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    if (names.includes('mail-worker') && names.includes('mail-vue')) return dir;
    for (const n of names) {
      if (n === 'node_modules' || n === '.git') continue;
      const p = path.join(dir, n);
      try {
        if (!fs.statSync(p).isDirectory()) continue;
        const depth = path.relative(root, p).split(path.sep).filter(Boolean).length;
        if (depth <= 2) stack.push(p);
      } catch {}
    }
  }
  return null;
}

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

async function gitClone(url, repoDir, onEvent) {
  emit(onEvent, { step: 'clone', status: 'run', message: 'git clone --depth 1 ' + url });
  await run(
    'git',
    [
      'clone',
      '--depth', '1',
      '--single-branch',
      '--branch', 'main',
      '--config', 'http.version=HTTP/1.1',
      '--config', 'http.postBuffer=524288000',
      url,
      repoDir,
    ],
    {
      timeout: 180000,
      env: { GIT_TERMINAL_PROMPT: '0' },
      onLog: (x) => emit(onEvent, { step: 'clone', status: 'log', message: x.text }),
    }
  );
  if (!looksLikeRepo(repoDir)) throw new Error('clone incomplete: missing mail-worker/mail-vue');
}

async function gitUpdate(repoDir, onEvent) {
  emit(onEvent, { step: 'clone', status: 'run', message: 'git fetch origin main' });
  try {
    await run('git', ['-c', 'http.version=HTTP/1.1', 'fetch', '--depth', '1', 'origin', 'main'], {
      cwd: repoDir,
      timeout: 120000,
      env: { GIT_TERMINAL_PROMPT: '0' },
      onLog: (x) => emit(onEvent, { step: 'clone', status: 'log', message: x.text }),
    });
    try {
      await run('git', ['reset', '--hard', 'origin/main'], { cwd: repoDir, timeout: 30000 });
    } catch {
      await run('git', ['checkout', 'main'], { cwd: repoDir, timeout: 30000 });
      await run('git', ['reset', '--hard', 'origin/main'], { cwd: repoDir, timeout: 30000 });
    }
    if (!looksLikeRepo(repoDir)) throw new Error('updated repo missing mail-worker');
    return true;
  } catch (e) {
    emit(onEvent, { step: 'clone', status: 'warn', message: 'git fetch failed: ' + e.message });
    return false;
  }
}

async function downloadZip(url, workDir, repoDir, onEvent) {
  emit(onEvent, { step: 'clone', status: 'run', message: 'download zip ' + url });
  const zipPath = path.join(workDir, 'cloud-mail.zip');
  const tmp = path.join(workDir, 'unpack-' + Date.now());
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error('zip HTTP ' + res.status + ' ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error('zip too small (' + buf.length + ' bytes)');
  fs.writeFileSync(zipPath, buf);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    await run('tar', ['-xf', zipPath, '-C', tmp], { timeout: 60000 });
  } catch (e1) {
    emit(onEvent, { step: 'clone', status: 'log', message: 'tar failed, try Expand-Archive' });
    await run(
      'powershell',
      ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath "' + zipPath + '" -DestinationPath "' + tmp + '" -Force'],
      { timeout: 60000 }
    );
  }
  const unpacked = findMailRepo(tmp);
  if (!unpacked) throw new Error('zip unpack did not contain mail-worker');
  rmDir(repoDir);
  fs.mkdirSync(path.dirname(repoDir), { recursive: true });
  fs.renameSync(unpacked, repoDir);
  rmDir(tmp);
  try { fs.unlinkSync(zipPath); } catch {}
  if (!looksLikeRepo(repoDir)) throw new Error('zip extract incomplete');
}

export async function ensureRepo(workDir, onEvent, opts) {
  const repoDir = path.join(workDir, 'cloud-mail');
  const root = (opts && opts.root) || path.resolve(workDir, '..');
  const vendorDir = path.join(root, 'vendor', 'cloud-mail');
  fs.mkdirSync(workDir, { recursive: true });

  if (looksLikeRepo(vendorDir)) {
    emit(onEvent, { step: 'clone', status: 'run', message: 'Using bundled vendor/cloud-mail (skip GitHub)' });
    rmDir(repoDir);
    fs.cpSync(vendorDir, repoDir, { recursive: true });
    if (!looksLikeRepo(repoDir)) throw new Error('vendor copy incomplete');
    emit(onEvent, { step: 'clone', status: 'ok', message: repoDir });
    return repoDir;
  }
  emit(onEvent, { step: 'clone', status: 'warn', message: 'vendor/cloud-mail missing, fallback to git/zip' });

  const hasGit = await commandExists('git');
  if (hasGit && looksLikeRepo(repoDir) && fs.existsSync(path.join(repoDir, '.git'))) {
    const ok = await gitUpdate(repoDir, onEvent);
    if (ok) {
      emit(onEvent, { step: 'clone', status: 'ok', message: 'updated ' + repoDir });
      return repoDir;
    }
    emit(onEvent, { step: 'clone', status: 'warn', message: 'local repo stale, re-clone' });
  }

  if (fs.existsSync(repoDir) && !looksLikeRepo(repoDir)) {
    emit(onEvent, { step: 'clone', status: 'log', message: 'remove broken clone' });
    rmDir(repoDir);
  }

  if (hasGit) {
    for (let i = 0; i < GIT_URLS.length; i++) {
      const url = GIT_URLS[i];
      rmDir(repoDir);
      try {
        await gitClone(url, repoDir, onEvent);
        emit(onEvent, { step: 'clone', status: 'ok', message: 'cloned via ' + url });
        return repoDir;
      } catch (e) {
        emit(onEvent, { step: 'clone', status: 'warn', message: 'git failed: ' + e.message });
        rmDir(repoDir);
      }
    }
  } else {
    emit(onEvent, { step: 'clone', status: 'log', message: 'git not found, use zip' });
  }

  for (let i = 0; i < ZIP_URLS.length; i++) {
    const url = ZIP_URLS[i];
    try {
      rmDir(repoDir);
      await downloadZip(url, workDir, repoDir, onEvent);
      emit(onEvent, { step: 'clone', status: 'ok', message: 'zip via ' + url });
      return repoDir;
    } catch (e) {
      emit(onEvent, { step: 'clone', status: 'warn', message: 'zip failed: ' + e.message });
      rmDir(repoDir);
    }
  }

  throw new Error(
    '无法获取 cloud-mail 源码。GitHub 连接被重置（curl 56）。请设置 HTTPS_PROXY 后重试，或检查本机能否打开 github.com。'
  );
}
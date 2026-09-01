import { spawn } from 'node:child_process';

export function run(command, args, opts) {
  const cwd = opts && opts.cwd;
  const env = opts && opts.env;
  const onLog = opts && opts.onLog;
  const timeout = opts && opts.timeout;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: Object.assign({}, process.env, env || {}),
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;
    if (timeout) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
      }, timeout);
    }
    if (child.stdout) {
      child.stdout.on('data', (buf) => {
        const s = buf.toString();
        stdout += s;
        if (onLog) onLog({ stream: 'stdout', text: s });
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (buf) => {
        const s = buf.toString();
        stderr += s;
        if (onLog) onLog({ stream: 'stderr', text: s });
      });
    }
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0 && !timedOut) resolve({ code, stdout, stderr });
      else {
        const tail = String(stderr || stdout || '')
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-4)
          .join(' | ');
        const err = new Error(
          (timedOut ? command + ' timeout' : command + ' exit ' + code) + (tail ? ': ' + tail : '')
        );
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
      }
    });
  });
}

export async function commandExists(bin) {
  try {
    await run(bin, ['--version'], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}
import fs from 'node:fs';
import path from 'node:path';
import { commandExists, run } from './proc.mjs';

const PNPM_VERSION = '9';

export const REGISTRIES = [
  process.env.npm_config_registry,
  process.env.NPM_CONFIG_REGISTRY,
  'https://registry.npmmirror.com',
  'https://registry.npmjs.org',
].filter((v, i, arr) => v && arr.indexOf(v) === i);

function emit(onEvent, payload) {
  if (typeof onEvent === 'function') onEvent({ ts: new Date().toISOString(), ...payload });
}

function pnpmJs(toolsDir) {
  return path.join(toolsDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
}

export function createPnpmRunner(pnpmCjs, registry, nodeExecPath) {
  const nodeBin = nodeExecPath || process.execPath;
  return {
    registry,
    bin: pnpmCjs,
    nodeExecPath: nodeBin,
    run(args, opts) {
      const extra = (opts && opts.env) || {};
      const env = Object.assign(
        {
          CI: 'true',
          npm_config_update_notifier: 'false',
          npm_config_fund: 'false',
          npm_config_audit: 'false',
          npm_config_fetch_retries: '5',
        },
        extra
      );
      if (registry && !env.npm_config_registry) env.npm_config_registry = registry;
      const nodeDir = path.dirname(nodeBin);
      env.PATH = nodeDir + path.delimiter + (env.PATH || process.env.PATH || '');
      return run(nodeBin, [pnpmCjs, ...args], Object.assign({}, opts, { env }));
    },
  };
}

async function runNpm(nodeExecPath, npmCli, args, opts) {
  if (npmCli && nodeExecPath) {
    return run(nodeExecPath, [npmCli, ...args], opts);
  }
  if (!(await commandExists('npm'))) {
    throw new Error('需要 Node.js 自带的 npm。请先安装 Node.js 22+ 后再部署。');
  }
  return run('npm', args, opts);
}

export async function ensurePnpm(root, onEvent, nodeInfo) {
  const nodeExecPath = (nodeInfo && nodeInfo.execPath) || process.execPath;
  const npmCli = nodeInfo && nodeInfo.npmCli;
  const toolsDir = path.join(root, 'work', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  const js = pnpmJs(toolsDir);

  if (fs.existsSync(js)) {
    try {
      await run(nodeExecPath, [js, '--version'], { timeout: 15000 });
      emit(onEvent, { step: 'install', status: 'ok', message: 'Reuse local pnpm at work/tools' });
      return createPnpmRunner(js, REGISTRIES[0], nodeExecPath);
    } catch (e) {
      emit(onEvent, { step: 'install', status: 'warn', message: 'Cached pnpm broken, reinstall: ' + e.message });
      try { fs.rmSync(path.join(toolsDir, 'node_modules'), { recursive: true, force: true }); } catch {}
    }
  }

  emit(onEvent, { step: 'install', status: 'run', message: 'New environment: installing pnpm into work/tools' });

  let lastErr = null;
  for (const registry of REGISTRIES) {
    emit(onEvent, { step: 'install', status: 'log', message: 'npm install pnpm@' + PNPM_VERSION + ' via ' + registry });
    try {
      await runNpm(
        nodeExecPath,
        npmCli,
        [
          'install',
          'pnpm@' + PNPM_VERSION,
          '--prefix',
          toolsDir,
          '--no-fund',
          '--no-audit',
          '--registry',
          registry,
        ],
        {
          timeout: 180000,
          env: {
            npm_config_registry: registry,
            npm_config_update_notifier: 'false',
          },
          onLog: (x) => emit(onEvent, { step: 'install', status: 'log', message: x.text }),
        }
      );
      if (fs.existsSync(js)) {
        emit(onEvent, { step: 'install', status: 'ok', message: 'pnpm ready at work/tools (' + registry + ')' });
        return createPnpmRunner(js, registry, nodeExecPath);
      }
      lastErr = new Error('pnpm files missing after npm install via ' + registry);
    } catch (e) {
      lastErr = e;
      emit(onEvent, { step: 'install', status: 'warn', message: 'pnpm bootstrap failed via ' + registry + ': ' + e.message });
    }
  }
  throw new Error('无法自动安装 pnpm：' + (lastErr && lastErr.message ? lastErr.message : 'unknown'));
}

export async function pnpmInstall(pnpm, dir, onEvent, step) {
  const name = path.basename(dir);
  emit(onEvent, { step, status: 'run', message: 'Install ' + name + ' dependencies' });
  const registries = [pnpm.registry, ...REGISTRIES].filter((v, i, arr) => v && arr.indexOf(v) === i);
  let lastErr = null;
  for (const registry of registries) {
    emit(onEvent, { step, status: 'log', message: name + ' pnpm install via ' + registry });
    try {
      await pnpm.run(['install', '--registry', registry, '--frozen-lockfile=false'], {
        cwd: dir,
        timeout: 600000,
        env: { npm_config_registry: registry, CI: 'true' },
        onLog: (x) => emit(onEvent, { step, status: 'log', message: x.text }),
      });
      if (!fs.existsSync(path.join(dir, 'node_modules'))) {
        throw new Error(name + ' node_modules 未生成');
      }
      emit(onEvent, { step, status: 'ok', message: name + ' dependencies installed' });
      return;
    } catch (e) {
      lastErr = e;
      emit(onEvent, { step, status: 'warn', message: name + ' install failed via ' + registry + ': ' + e.message });
    }
  }
  throw lastErr || new Error(name + ' 依赖安装失败');
}

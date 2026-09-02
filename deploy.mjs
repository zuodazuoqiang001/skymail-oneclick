#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCf, listAccounts, listZones } from './lib/cf.mjs';
import { defaultStatePath, deploy, loadState, saveState, sanitizeResult } from './lib/deployer.mjs';
import { startServer } from './lib/server.mjs';
import { applyProxyFromEnv, checkCloudflareApi } from './lib/net.mjs';
import { relaunchIfNeeded } from './lib/node.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cli') args.cli = true;
    else if (a === '--no-open') args.noOpen = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i += 1;
      }
    } else args._.push(a);
  }
  return args;
}

function printHelp() {
  const text = [
    'Skymail one-click deployer',
    '',
    '  node deploy.mjs                 Start local wizard (default)',
    '  node deploy.mjs --port 8788     Wizard port',
    '  node deploy.mjs --no-open       Do not open browser',
    '  node deploy.mjs --cli \\',
    '      --token <CF_TOKEN> \\',
    '      --account <ACCOUNT_ID> \\',
    '      --zone example.com \\',
    '      --site mail.example.com \\',
    '      --admin admin@example.com \\',
    '      [--worker cloud-mail] [--replace-mx] [--no-r2]',
    '',
  ].join('\n');
  process.stdout.write(text);
}

function openBrowser(target) {
  const plat = process.platform;
  if (plat === 'win32') spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' });
  else if (plat === 'darwin') spawn('open', [target], { detached: true, stdio: 'ignore' });
  else spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
}

async function runCli(args) {
  const token = args.token || process.env.CLOUDFLARE_API_TOKEN || '';
  if (!token) throw new Error('Need --token or CLOUDFLARE_API_TOKEN');
  const cf = createCf(token);
  const accounts = await listAccounts(cf);
  const zones = await listZones(cf);
  let accountId = args.account || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  if (!accountId) {
    if (accounts.length === 1) accountId = accounts[0].id;
    else throw new Error('Multiple accounts, pass --account');
  }
  const zoneNames = String(args.zone || args.zones || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!zoneNames.length) throw new Error('Need --zone example.com');
  const mailDomains = zoneNames.map((name) => {
    const z = zones.find((x) => x.name === name);
    if (!z) throw new Error('Zone not found in this token: ' + name);
    return { id: z.id, name: z.name };
  });
  const siteHostname = args.site || 'mail.' + mailDomains[0].name;
  const admin = args.admin || 'admin@' + mailDomains[0].name;
  const result = await deploy(
    {
      token,
      accountId,
      workerName: args.worker || 'cloud-mail',
      siteHostname,
      mailDomains,
      allZones: zones,
      admin,
      enableR2: args['no-r2'] ? false : true,
      replaceMx: Boolean(args['replace-mx'] || args.replaceMx),
      root: ROOT,
    },
    (evt) => {
      const line = '[' + (evt.step || '-') + '] ' + (evt.status || '') + ' ' + (evt.message || '');
      process.stdout.write(line.trim() + '\n');
    }
  );
  saveState(defaultStatePath(ROOT), result);
  process.stdout.write('\nDone\n' + JSON.stringify(sanitizeResult(result), null, 2) + '\n');
}

async function main() {
  const proxy = applyProxyFromEnv();
  await relaunchIfNeeded(ROOT, process.argv.slice(2), fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.cli) {
    await runCli(args);
    return;
  }
  const port = Number(args.port || 8788);
  const started = await startServer({
    root: ROOT,
    webDir: path.join(ROOT, 'web'),
    port,
  });
  process.stdout.write('Skymail wizard: ' + started.url + '\n');
  process.stdout.write('Token stays on this machine. Ctrl+C to stop.\n');
  if (proxy) process.stdout.write('Using proxy: ' + proxy + '\n');
  const net = await checkCloudflareApi();
  if (net.ok) process.stdout.write('Cloudflare API reachable (HTTP ' + net.status + ')\n');
  else process.stdout.write('WARNING Cloudflare API unreachable: ' + net.error + '\n');
  if (!args.noOpen) openBrowser(started.url);
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';
import { cleanupOrphans, createCf, findNamedResources, listAccounts, listZones, resolveNamePlan, verifyToken } from './cf.mjs';
import { checkCloudflareApi, wrapNetworkError } from './net.mjs';
import { defaultStatePath, deploy, loadState, saveState, sanitizeResult } from './deployer.mjs';
import { inspectMailDeploy, purgeMailDeploy } from './purge.mjs';

export const APP_VERSION = '0.1';
export const WIZARD_VERSION = 8;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers) {
  const extra = headers || {};
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store' }, extra));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export function startServer(opts) {
  const root = opts.root;
  const webDir = opts.webDir;
  const port = opts.port || 8788;
  const stateFile = defaultStatePath(root);

  const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname || '/';
    try {
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const file = path.join(webDir, 'index.html');
        return send(res, 200, fs.readFileSync(file), { 'Content-Type': 'text/html; charset=utf-8' });
      }
      if (req.method === 'GET' && pathname.startsWith('/assets/')) {
        const file = path.normalize(path.join(webDir, pathname.slice(1)));
        if (!file.startsWith(webDir)) return send(res, 403, 'forbidden');
        if (!fs.existsSync(file)) return send(res, 404, 'not found');
        const ext = path.extname(file);
        return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      }
      if (req.method === 'GET' && pathname === '/api/health') {
        return send(res, 200, { ok: true, name: 'skymail-oneclick', appVersion: APP_VERSION, version: WIZARD_VERSION, features: ['cleanup', 'mirrors'] }, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'GET' && pathname === '/api/netcheck') {
        const net = await checkCloudflareApi();
        return send(res, net.ok ? 200 : 503, net, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'GET' && pathname === '/api/state') {
        const state = loadState(stateFile) || {};
        return send(res, 200, sanitizeResult(state), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'POST' && pathname === '/api/session') {
        const body = await readBody(req);
        const token = String(body.token || '').trim();
        const cf = createCf(token);
        const verify = await verifyToken(cf);
        const accounts = await listAccounts(cf);
        const zones = await listZones(cf);
        return send(
          res,
          200,
          { verify, accounts, zones },
          { 'Content-Type': 'application/json; charset=utf-8' }
        );
      }
      if (req.method === 'POST' && pathname === '/api/plan') {
        const body = await readBody(req);
        const token = String(body.token || '').trim();
        const accountId = String(body.accountId || '').trim();
        const workerName = String(body.workerName || 'cloud-mail').trim();
        const strategy = body.nameStrategy === 'suffix' || body.nameStrategy === 'replace' ? body.nameStrategy : 'reuse';
        const cf = createCf(token);
        const plan = await resolveNamePlan(cf, accountId, workerName, strategy);
        return send(res, 200, plan, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'POST' && pathname === '/api/orphans') {
        const body = await readBody(req);
        const token = String(body.token || '').trim();
        const accountId = String(body.accountId || '').trim();
        const workerName = String(body.workerName || 'cloud-mail').trim();
        const cf = createCf(token);
        const found = await findNamedResources(cf, accountId, workerName);
        const orphan = !found.worker && Boolean(found.d1 || found.kv || found.r2);
        return send(res, 200, { found, orphan, workerName }, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'POST' && pathname === '/api/cleanup') {
        const body = await readBody(req);
        const token = String(body.token || '').trim();
        const accountId = String(body.accountId || '').trim();
        const workerName = String(body.workerName || 'cloud-mail').trim();
        const cf = createCf(token);
        const result = await cleanupOrphans(cf, accountId, workerName);
        return send(res, 200, result, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'POST' && pathname === '/api/purge/preview') {
        const body = await readBody(req);
        const token = String(body.token || '').trim();
        const accountId = String(body.accountId || '').trim();
        const query = String(body.query || '').trim();
        const cf = createCf(token);
        const inspect = await inspectMailDeploy(cf, { accountId, query });
        return send(res, 200, inspect, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'POST' && pathname === '/api/purge') {
        const body = await readBody(req);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const sendEvent = (event, data) => {
          res.write('event: ' + event + '\n');
          res.write('data: ' + JSON.stringify(data) + '\n\n');
        };
        try {
          const cf = createCf(String(body.token || '').trim());
          const result = await purgeMailDeploy(
            cf,
            {
              accountId: String(body.accountId || '').trim(),
              query: String(body.query || '').trim(),
              deleteWorker: body.deleteWorker !== false,
              deleteDomains: body.deleteDomains !== false,
              deleteD1: body.deleteD1 !== false,
              deleteKv: body.deleteKv !== false,
              deleteR2: body.deleteR2 !== false,
              disableCatchAll: body.disableCatchAll !== false,
              deleteMx: Boolean(body.deleteMx),
            },
            (evt) => sendEvent('log', evt)
          );
          sendEvent('done', result);
        } catch (e) {
          sendEvent('error', { message: e.message });
        }
        res.end();
        return;
      }
      if (req.method === 'POST' && pathname === '/api/deploy') {
        const body = await readBody(req);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const sendEvent = (event, data) => {
          res.write('event: ' + event + '\n');
          res.write('data: ' + JSON.stringify(data) + '\n\n');
        };
        try {
          const result = await deploy(
            {
              token: body.token,
              accountId: body.accountId,
              workerName: body.workerName,
              siteHostname: body.siteHostname,
              mailDomains: body.mailDomains,
              allZones: body.allZones,
              admin: body.admin,
              jwtSecret: body.jwtSecret,
              nameStrategy: body.nameStrategy,
              enableR2: body.enableR2 !== false,
              replaceMx: Boolean(body.replaceMx),
              root,
            },
            (evt) => sendEvent('log', evt)
          );
          saveState(stateFile, result);
          sendEvent('done', sanitizeResult(result));
        } catch (e) {
          sendEvent('error', { message: e.message, stdout: e.stdout, stderr: e.stderr });
        }
        res.end();
        return;
      }
      send(res, 404, { error: 'not found' }, { 'Content-Type': 'application/json; charset=utf-8' });
    } catch (e) {
      const wrapped = e && e.code ? e : wrapNetworkError(e);
      send(res, 500, { error: wrapped.message }, { 'Content-Type': 'application/json; charset=utf-8' });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port, url: 'http://127.0.0.1:' + port });
    });
  });
}
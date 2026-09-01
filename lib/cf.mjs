import { wrapNetworkError } from './net.mjs';

const CF_API = 'https://api.cloudflare.com/client/v4';

export function createCf(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Missing Cloudflare API Token');
  }
  const auth = token.trim();

  async function raw(method, path, body, headers = {}) {
    const url = path.startsWith('http') ? path : CF_API + path;
    const init = {
      method,
      headers: {
        Authorization: 'Bearer ' + auth,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(25000) }, init));
    } catch (e) {
      throw wrapNetworkError(e, url);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { res, json, text };
  }

  async function request(method, path, body) {
    const { res, json } = await raw(method, path, body);
    if (!json || json.success === false || (res.status >= 400 && json.success !== true)) {
      const msg = formatCfError(json, res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.cf = json;
      throw err;
    }
    return json.result;
  }

  async function listAll(path) {
    const out = [];
    let page = 1;
    const join = path.includes('?') ? '&' : '?';
    while (true) {
      const { res, json } = await raw('GET', path + join + 'page=' + page + '&per_page=50');
      if (!json || json.success === false || res.status >= 400) {
        throw new Error(formatCfError(json, res.status));
      }
      const chunk = Array.isArray(json.result) ? json.result : [];
      out.push(...chunk);
      const info = json.result_info;
      if (!info || page >= (info.total_pages || 1) || chunk.length === 0) break;
      page += 1;
    }
    return out;
  }

  return {
    token: auth,
    raw,
    request,
    listAll,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}

export function formatCfError(json, status) {
  if (!json) return 'Cloudflare API HTTP ' + status;
  const errors = json.errors || [];
  if (errors.length) {
    return errors
      .map((e) => {
        const extra = (e.error_chain || [])
          .map((c) => c.message)
          .filter(Boolean)
          .join(' | ');
        return extra ? e.message + ' (' + extra + ')' : e.message || JSON.stringify(e);
      })
      .join('; ');
  }
  if (json.messages && json.messages.length) {
    return json.messages.map((m) => m.message || m).join('; ');
  }
  if (json.raw) return String(json.raw).slice(0, 400);
  return 'Cloudflare API HTTP ' + status;
}

export async function verifyToken(cf) {
  return cf.get('/user/tokens/verify');
}

export async function listAccounts(cf) {
  return cf.listAll('/accounts');
}

export async function listZones(cf) {
  return cf.listAll('/zones?status=active');
}

export async function ensureD1(cf, accountId, name) {
  const list = await cf.listAll('/accounts/' + accountId + '/d1/database');
  const hit = list.find((d) => d.name === name);
  if (hit) return { created: false, id: hit.uuid || hit.id, name: hit.name, raw: hit };
  const created = await cf.post('/accounts/' + accountId + '/d1/database', { name });
  return { created: true, id: created.uuid || created.id, name: created.name, raw: created };
}

export async function ensureKv(cf, accountId, title) {
  const list = await cf.listAll('/accounts/' + accountId + '/storage/kv/namespaces');
  const hit = list.find((n) => n.title === title);
  if (hit) return { created: false, id: hit.id, title: hit.title, raw: hit };
  const created = await cf.post('/accounts/' + accountId + '/storage/kv/namespaces', { title });
  return { created: true, id: created.id, title: created.title, raw: created };
}

export async function listR2Buckets(cf, accountId) {
  const result = await cf.get('/accounts/' + accountId + '/r2/buckets');
  if (Array.isArray(result)) return result;
  if (result && result.buckets) return result.buckets;
  return [];
}

export async function ensureR2(cf, accountId, name) {
  const buckets = await listR2Buckets(cf, accountId);
  const hit = buckets.find((b) => (b.name || b) === name);
  if (hit) return { created: false, name, raw: hit };
  const created = await cf.post('/accounts/' + accountId + '/r2/buckets', { name });
  return { created: true, name, raw: created };
}

export async function enableWorkersSubdomain(cf, accountId) {
  try {
    return await cf.get('/accounts/' + accountId + '/workers/subdomain');
  } catch {
    try {
      return await cf.put('/accounts/' + accountId + '/workers/subdomain', { enabled: true });
    } catch (e) {
      return { skipped: true, error: e.message };
    }
  }
}

export async function attachWorkerDomain(cf, accountId, opts) {
  const hostname = opts.hostname;
  const service = opts.service;
  const zoneId = opts.zoneId;
  const existing = await cf.get('/accounts/' + accountId + '/workers/domains');
  const list = Array.isArray(existing)
    ? existing
    : Array.isArray(existing && existing.result)
      ? existing.result
      : [];
  const hit = list.find((d) => d.hostname === hostname);
  if (hit && hit.service === service) return { created: false, raw: hit };
  const body = {
    hostname,
    service,
    zone_id: zoneId,
    environment: 'production',
  };
  try {
    return { created: true, raw: await cf.put('/accounts/' + accountId + '/workers/domains', body) };
  } catch (e) {
    try {
      return { created: true, raw: await cf.post('/accounts/' + accountId + '/workers/domains', body) };
    } catch {
      throw e;
    }
  }
}

export async function getEmailRouting(cf, zoneId) {
  return cf.get('/zones/' + zoneId + '/email/routing');
}

export async function enableEmailRouting(cf, zoneId) {
  try {
    return await cf.post('/zones/' + zoneId + '/email/routing/dns');
  } catch (e) {
    try {
      return await cf.post('/zones/' + zoneId + '/email/routing/enable');
    } catch {
      throw e;
    }
  }
}

export async function listDns(cf, zoneId, type) {
  const q = type ? '&type=' + encodeURIComponent(type) : '';
  return cf.listAll('/zones/' + zoneId + '/dns_records?per_page=100' + q);
}

export async function deleteDnsRecord(cf, zoneId, recordId) {
  return cf.delete('/zones/' + zoneId + '/dns_records/' + recordId);
}

export async function setCatchAllWorker(cf, zoneId, workerName) {
  return cf.put('/zones/' + zoneId + '/email/routing/rules/catch_all', {
    enabled: true,
    name: workerName + ' catch-all',
    matchers: [{ type: 'all' }],
    actions: [{ type: 'worker', value: [workerName] }],
  });
}

export async function probePermissions(cf, accountId) {
  const checks = [];
  async function check(id, label, fn) {
    try {
      await fn();
      checks.push({ id, label, ok: true });
    } catch (e) {
      checks.push({ id, label, ok: false, error: e.message });
    }
  }
  await check('accounts', 'Account Read', () => cf.get('/accounts?per_page=1'));
  await check('zones', 'Zone Read', () => cf.get('/zones?per_page=1'));
  if (accountId) {
    await check('d1', 'D1', () => cf.get('/accounts/' + accountId + '/d1/database?per_page=1'));
    await check('kv', 'Workers KV', () => cf.get('/accounts/' + accountId + '/storage/kv/namespaces?per_page=1'));
    await check('r2', 'R2', () => cf.get('/accounts/' + accountId + '/r2/buckets'));
    await check('workers', 'Workers Scripts', () => cf.get('/accounts/' + accountId + '/workers/scripts'));
  }
  return checks;
}
export async function listWorkers(cf, accountId) {
  const result = await cf.get('/accounts/' + accountId + '/workers/scripts');
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.scripts)) return result.scripts;
  return [];
}

export async function deleteD1(cf, accountId, databaseId) {
  return cf.delete('/accounts/' + accountId + '/d1/database/' + databaseId);
}

export async function deleteKv(cf, accountId, namespaceId) {
  return cf.delete('/accounts/' + accountId + '/storage/kv/namespaces/' + namespaceId);
}

export async function deleteR2Bucket(cf, accountId, name) {
  return cf.delete('/accounts/' + accountId + '/r2/buckets/' + encodeURIComponent(name));
}

export function relatedResourceNames(workerName) {
  const base = String(workerName || 'cloud-mail').trim() || 'cloud-mail';
  const d1Names = [base, base + '-db'];
  const kvTitles = [base + '-kv'];
  const r2Names = [base.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-r2'];
  return {
    d1Names: Array.from(new Set(d1Names)),
    kvTitles: Array.from(new Set(kvTitles)),
    r2Names: Array.from(new Set(r2Names)),
  };
}

export async function findNamedResources(cf, accountId, workerName) {
  const names = relatedResourceNames(workerName);
  const d1All = await cf.listAll('/accounts/' + accountId + '/d1/database');
  const kvAll = await cf.listAll('/accounts/' + accountId + '/storage/kv/namespaces');
  let r2All = [];
  try {
    r2All = await listR2Buckets(cf, accountId);
  } catch {
    r2All = [];
  }
  let workers = [];
  try {
    workers = await listWorkers(cf, accountId);
  } catch {
    workers = [];
  }
  const worker = workers.find((w) => (w.id || w.name) === workerName) || null;
  const d1Matches = d1All.filter((d) => names.d1Names.indexOf(d.name) >= 0);
  const kvMatches = kvAll.filter((n) => names.kvTitles.indexOf(n.title) >= 0);
  const r2Matches = r2All.filter((b) => names.r2Names.indexOf(b.name || b) >= 0);
  const d1 = d1Matches[0] || null;
  const kv = kvMatches[0] || null;
  const r2 = r2Matches[0] || null;
  return {
    worker,
    d1,
    kv,
    r2,
    d1List: d1Matches,
    kvList: kvMatches,
    r2List: r2Matches,
    d1Name: names.d1Names[0],
    kvTitle: names.kvTitles[0],
    r2Name: names.r2Names[0],
    aliases: names,
  };
}

export async function cleanupOrphans(cf, accountId, workerName) {
  const found = await findNamedResources(cf, accountId, workerName);
  const deleted = [];
  const skipped = [];
  if (found.worker) {
    skipped.push('worker ' + workerName + ' already exists, keep D1/KV/R2');
    return { deleted, skipped, found, workerExists: true };
  }
  const d1List = found.d1List && found.d1List.length ? found.d1List : (found.d1 ? [found.d1] : []);
  const kvList = found.kvList && found.kvList.length ? found.kvList : (found.kv ? [found.kv] : []);
  const r2List = found.r2List && found.r2List.length ? found.r2List : (found.r2 ? [found.r2] : []);
  for (const row of d1List) {
    await deleteD1(cf, accountId, row.uuid || row.id);
    deleted.push('d1:' + row.name + ' ' + (row.uuid || row.id));
  }
  for (const row of kvList) {
    await deleteKv(cf, accountId, row.id);
    deleted.push('kv:' + row.title + ' ' + row.id);
  }
  for (const row of r2List) {
    const name = row.name || row;
    await deleteR2Bucket(cf, accountId, name);
    deleted.push('r2:' + name);
  }
  return { deleted, skipped, found, workerExists: false };
}

export async function deleteWorker(cf, accountId, name) {
  return cf.delete('/accounts/' + accountId + '/workers/scripts/' + encodeURIComponent(name));
}

export async function wipeNamedResources(cf, accountId, workerName) {
  const found = await findNamedResources(cf, accountId, workerName);
  const deleted = [];
  if (found.worker) {
    await deleteWorker(cf, accountId, workerName);
    deleted.push('worker:' + workerName);
  }
  const d1List = found.d1List && found.d1List.length ? found.d1List : (found.d1 ? [found.d1] : []);
  const kvList = found.kvList && found.kvList.length ? found.kvList : (found.kv ? [found.kv] : []);
  const r2List = found.r2List && found.r2List.length ? found.r2List : (found.r2 ? [found.r2] : []);
  for (const row of d1List) {
    await deleteD1(cf, accountId, row.uuid || row.id);
    deleted.push('d1:' + row.name);
  }
  for (const row of kvList) {
    await deleteKv(cf, accountId, row.id);
    deleted.push('kv:' + row.title);
  }
  for (const row of r2List) {
    const name = row.name || row;
    await deleteR2Bucket(cf, accountId, name);
    deleted.push('r2:' + name);
  }
  return { deleted, found };
}

export async function pickFreeWorkerName(cf, accountId, base) {
  const wanted = String(base || 'cloud-mail').trim() || 'cloud-mail';
  const d1s = await cf.listAll('/accounts/' + accountId + '/d1/database');
  const kvs = await cf.listAll('/accounts/' + accountId + '/storage/kv/namespaces');
  let r2s = [];
  try { r2s = await listR2Buckets(cf, accountId); } catch { r2s = []; }
  let workers = [];
  try { workers = await listWorkers(cf, accountId); } catch { workers = []; }
  const taken = (name) => {
    const kvTitle = name + '-kv';
    const r2Name = name.toLowerCase().replace(/[^a-z0-9-]/g, '-') + '-r2';
    if (workers.some((w) => (w.id || w.name) === name)) return true;
    if (d1s.some((d) => d.name === name)) return true;
    if (kvs.some((n) => n.title === kvTitle)) return true;
    if (r2s.some((b) => (b.name || b) === r2Name)) return true;
    return false;
  };
  if (!taken(wanted)) return wanted;
  const root = wanted.replace(/-\d+$/, '');
  for (let i = 2; i <= 30; i++) {
    const name = root + '-' + i;
    if (!taken(name)) return name;
  }
  throw new Error('没有可用的 Worker 名称（' + wanted + ' ~ ' + root + '-30 都被占用）');
}

export async function resolveNamePlan(cf, accountId, workerName, strategy) {
  const wanted = String(workerName || 'cloud-mail').trim() || 'cloud-mail';
  const mode = strategy === 'suffix' || strategy === 'replace' ? strategy : 'reuse';
  const found = await findNamedResources(cf, accountId, wanted);
  const exists = Boolean(found.worker || found.d1 || found.kv || found.r2);
  const hits = [];
  if (found.worker) hits.push('Worker ' + wanted);
  if (found.d1) hits.push('D1 ' + found.d1.name);
  if (found.kv) hits.push('KV ' + found.kv.title);
  if (found.r2) hits.push('R2 ' + (found.r2.name || found.r2));
  if (!exists) {
    return { wanted, finalName: wanted, strategy: mode, action: 'create', exists: false, found, hits };
  }
  if (mode === 'suffix') {
    const finalName = await pickFreeWorkerName(cf, accountId, wanted);
    return { wanted, finalName, strategy: mode, action: 'suffix', exists: true, found, hits };
  }
  if (mode === 'replace') {
    return { wanted, finalName: wanted, strategy: mode, action: 'replace', exists: true, found, hits };
  }
  return { wanted, finalName: wanted, strategy: 'reuse', action: 'reuse', exists: true, found, hits };
}

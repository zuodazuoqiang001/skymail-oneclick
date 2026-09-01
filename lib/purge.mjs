import { findNamedResources, listWorkers, listZones, listDns, deleteDnsRecord, deleteWorker, deleteD1, deleteKv, deleteR2Bucket } from './cf.mjs';

function emit(onEvent, payload) {
  if (typeof onEvent === 'function') onEvent({ ts: new Date().toISOString(), ...payload });
}

export function normalizeSiteInput(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/\/.*$/, '');
  s = s.replace(/:\d+$/, '');
  return s;
}

export function pickZoneForHost(zones, hostname) {
  if (!hostname) return null;
  const exact = (zones || []).find((z) => z.name === hostname);
  if (exact) return exact;
  return (zones || [])
    .filter((z) => hostname === z.name || hostname.endsWith('.' + z.name))
    .sort((a, b) => b.name.length - a.name.length)[0] || null;
}

async function listWorkerDomains(cf, accountId) {
  try {
    const existing = await cf.get('/accounts/' + accountId + '/workers/domains');
    return Array.isArray(existing) ? existing : [];
  } catch {
    return [];
  }
}

async function getWorkerBindings(cf, accountId, name) {
  const paths = [
    '/accounts/' + accountId + '/workers/scripts/' + encodeURIComponent(name) + '/settings',
    '/accounts/' + accountId + '/workers/scripts/' + encodeURIComponent(name),
  ];
  for (let i = 0; i < paths.length; i++) {
    try {
      const result = await cf.get(paths[i]);
      const bindings =
        (result && result.bindings) ||
        (result && result.script_settings && result.script_settings.bindings) ||
        [];
      if (Array.isArray(bindings) && bindings.length) return bindings;
    } catch {}
  }
  return [];
}

function parseBindings(bindings) {
  const out = { d1: [], kv: [], r2: [] };
  (bindings || []).forEach((b) => {
    const type = String(b.type || b.binding_type || '').toLowerCase();
    if (type === 'd1' || type === 'd1_database') {
      out.d1.push({ id: b.id || b.database_id, name: b.name || b.database_name || 'db' });
    } else if (type === 'kv_namespace' || type === 'kv') {
      out.kv.push({ id: b.namespace_id || b.id, name: b.name || 'kv' });
    } else if (type === 'r2_bucket' || type === 'r2') {
      out.r2.push({ name: b.bucket_name || b.name });
    }
  });
  return out;
}

async function getCatchAll(cf, zoneId) {
  try {
    return await cf.get('/zones/' + zoneId + '/email/routing/rules/catch_all');
  } catch {
    return null;
  }
}

function workerFromCatchAll(rule) {
  if (!rule) return '';
  const actions = rule.actions || [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (String(a.type || '').toLowerCase() !== 'worker') continue;
    const v = a.value;
    if (Array.isArray(v) && v[0]) return String(v[0]);
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

function isCfMx(content) {
  return /mx\.cloudflare\.net/i.test(content || '');
}

export async function inspectMailDeploy(cf, opts) {
  const accountId = opts.accountId;
  const query = normalizeSiteInput(opts.query);
  if (!query) throw new Error('请输入站点域名、邮箱域名或 Worker 名称');
  const zones = await listZones(cf);
  const zone = pickZoneForHost(zones, query);
  const domainList = await listWorkerDomains(cf, accountId);
  let domainHits = domainList.filter((d) => {
    const h = String(d.hostname || '').toLowerCase();
    return h === query || h.endsWith('.' + query) || query.endsWith('.' + h);
  });
  domainHits.sort((a, b) => {
    const ah = String(a.hostname || '');
    const bh = String(b.hostname || '');
    if (ah === query) return -1;
    if (bh === query) return 1;
    if (ah.startsWith('mail.') && !bh.startsWith('mail.')) return -1;
    if (bh.startsWith('mail.') && !ah.startsWith('mail.')) return 1;
    return bh.length - ah.length;
  });
  const domainHit = domainHits[0] || null;
  let workerName = (domainHit && (domainHit.service || domainHit.script)) || '';
  if (!workerName && /\.workers\.dev$/.test(query)) {
    workerName = query.split('.')[0];
  }
  if (!workerName) {
    const workers = await listWorkers(cf, accountId);
    const w = workers.find((x) => (x.id || x.name) === query);
    if (w) workerName = w.id || w.name;
  }
  let catchAll = null;
  if (zone) {
    catchAll = await getCatchAll(cf, zone.id);
    const fromCatch = workerFromCatchAll(catchAll);
    if (!workerName && fromCatch) workerName = fromCatch;
  }
  if (!workerName && query.indexOf('.') < 0) workerName = query;

  const named = workerName
    ? await findNamedResources(cf, accountId, workerName)
    : { worker: null, d1: null, kv: null, r2: null, d1Name: '', kvTitle: '', r2Name: '' };

  const bindings = workerName ? await getWorkerBindings(cf, accountId, workerName) : [];
  const bound = parseBindings(bindings);

  const workerDomains = workerName
    ? domainList.filter((d) => (d.service || d.script) === workerName)
    : domainHits;

  let mx = [];
  if (zone) {
    try { mx = await listDns(cf, zone.id, 'MX'); } catch { mx = []; }
  }
  const cfMx = mx.filter((r) => isCfMx(r.content));

  const d1Map = {};
  (named.d1List || (named.d1 ? [named.d1] : [])).forEach((row) => {
    const id = row.uuid || row.id;
    if (id) d1Map[id] = { id, name: row.name };
  });
  (bound.d1 || []).forEach((row) => {
    if (row.id) d1Map[row.id] = { id: row.id, name: row.name || row.id };
  });
  const kvMap = {};
  (named.kvList || (named.kv ? [named.kv] : [])).forEach((row) => {
    if (row.id) kvMap[row.id] = { id: row.id, title: row.title };
  });
  (bound.kv || []).forEach((row) => {
    if (row.id) kvMap[row.id] = { id: row.id, title: row.name || row.id };
  });
  const r2Map = {};
  (named.r2List || (named.r2 ? [named.r2] : [])).forEach((row) => {
    const name = row.name || row;
    if (name) r2Map[name] = { name };
  });
  (bound.r2 || []).forEach((row) => {
    if (row.name) r2Map[row.name] = { name: row.name };
  });
  const d1s = Object.keys(d1Map).map((k) => d1Map[k]);
  const kvs = Object.keys(kvMap).map((k) => kvMap[k]);
  const r2s = Object.keys(r2Map).map((k) => r2Map[k]);

  const targets = {
    worker: named.worker ? { name: workerName } : (workerName ? { name: workerName, missing: !named.worker } : null),
    domains: workerDomains.map((d) => ({ id: d.id, hostname: d.hostname, service: d.service || d.script, zoneId: d.zone_id })),
    d1: d1s[0] || null,
    kv: kvs[0] || null,
    r2: r2s[0] || null,
    d1s,
    kvs,
    r2s,
    catchAll: catchAll && workerFromCatchAll(catchAll) === workerName ? { zoneId: zone && zone.id, zoneName: zone && zone.name, worker: workerName, enabled: catchAll.enabled !== false } : null,
    mx: cfMx.map((r) => ({ id: r.id, name: r.name, content: r.content })),
    zone: zone ? { id: zone.id, name: zone.name } : null,
  };

  const foundAny = Boolean(
    (targets.worker && !targets.worker.missing) ||
    targets.domains.length ||
    targets.d1s.length ||
    targets.kvs.length ||
    targets.r2s.length ||
    targets.catchAll
  );

  return {
    query,
    accountId,
    workerName: workerName || '',
    foundAny,
    zone: targets.zone,
    targets,
  };
}

export async function disableCatchAll(cf, zoneId) {
  return cf.put('/zones/' + zoneId + '/email/routing/rules/catch_all', {
    enabled: false,
    name: 'disabled by skymail-oneclick',
    matchers: [{ type: 'all' }],
    actions: [{ type: 'drop' }],
  });
}

export async function deleteWorkerDomain(cf, accountId, domainId) {
  return cf.delete('/accounts/' + accountId + '/workers/domains/' + domainId);
}

export async function purgeMailDeploy(cf, opts, onEvent) {
  const accountId = opts.accountId;
  const inspect = opts.inspect || (await inspectMailDeploy(cf, opts));
  if (!inspect.foundAny) throw new Error('没有找到可清空的 Cloud Mail 资源：' + inspect.query);
  const t = inspect.targets;
  const flags = {
    worker: opts.deleteWorker !== false,
    domains: opts.deleteDomains !== false,
    d1: opts.deleteD1 !== false,
    kv: opts.deleteKv !== false,
    r2: opts.deleteR2 !== false,
    catchAll: opts.disableCatchAll !== false,
    mx: Boolean(opts.deleteMx),
  };
  const results = [];
  async function step(id, label, enabled, fn) {
    if (!enabled) {
      results.push({ id, label, status: 'skip' });
      emit(onEvent, { step: 'purge', status: 'skip', message: 'skip ' + label });
      return;
    }
    emit(onEvent, { step: 'purge', status: 'run', message: label });
    try {
      await fn();
      results.push({ id, label, status: 'ok' });
      emit(onEvent, { step: 'purge', status: 'ok', message: label });
    } catch (e) {
      results.push({ id, label, status: 'bad', error: e.message });
      emit(onEvent, { step: 'purge', status: 'warn', message: label + ' failed: ' + e.message });
    }
  }

  await step('catchAll', 'Disable Email Routing catch-all', flags.catchAll && t.catchAll, async () => {
    await disableCatchAll(cf, t.catchAll.zoneId);
  });
  if (flags.domains) {
    for (let i = 0; i < t.domains.length; i++) {
      const d = t.domains[i];
      await step('domain:' + d.hostname, 'Unbind ' + d.hostname, true, async () => {
        await deleteWorkerDomain(cf, accountId, d.id);
      });
    }
  }
  await step('worker', 'Delete Worker ' + (t.worker && t.worker.name), flags.worker && t.worker && t.worker.name, async () => {
    await deleteWorker(cf, accountId, t.worker.name);
  });
  const r2s = t.r2s && t.r2s.length ? t.r2s : (t.r2 ? [t.r2] : []);
  const kvs = t.kvs && t.kvs.length ? t.kvs : (t.kv ? [t.kv] : []);
  const d1s = t.d1s && t.d1s.length ? t.d1s : (t.d1 ? [t.d1] : []);
  for (let i = 0; i < r2s.length; i++) {
    const row = r2s[i];
    await step('r2:' + row.name, 'Delete R2 ' + row.name, flags.r2 && row.name, async () => {
      await deleteR2Bucket(cf, accountId, row.name);
    });
  }
  for (let i = 0; i < kvs.length; i++) {
    const row = kvs[i];
    await step('kv:' + row.id, 'Delete KV ' + (row.title || row.id), flags.kv && row.id, async () => {
      await deleteKv(cf, accountId, row.id);
    });
  }
  for (let i = 0; i < d1s.length; i++) {
    const row = d1s[i];
    await step('d1:' + row.id, 'Delete D1 ' + (row.name || row.id), flags.d1 && row.id, async () => {
      await deleteD1(cf, accountId, row.id);
    });
  }
  if (flags.mx && t.mx && t.mx.length) {
    for (let i = 0; i < t.mx.length; i++) {
      const rec = t.mx[i];
      await step('mx:' + rec.id, 'Delete MX ' + rec.name + ' -> ' + rec.content, true, async () => {
        await deleteDnsRecord(cf, t.zone.id, rec.id);
      });
    }
  } else {
    results.push({ id: 'mx', label: 'MX', status: 'skip' });
  }
  return { inspect, results };
}
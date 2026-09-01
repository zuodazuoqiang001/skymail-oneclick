import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

function readProxy() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    ''
  );
}

export function applyProxyFromEnv() {
  const proxy = readProxy();
  if (proxy && !process.env.NODE_USE_ENV_PROXY) {
    process.env.NODE_USE_ENV_PROXY = '1';
  }
  return proxy;
}

export function currentProxy() {
  return readProxy();
}

export function wrapNetworkError(e, url) {
  const cause = e && e.cause ? e.cause : {};
  const code = cause.code || e.code || '';
  const detail = [e && e.message, code, cause.syscall, cause.address, cause.port]
    .filter(Boolean)
    .join(' ');
  let hint = '';
  if (code === 'EACCES' || code === 'EPERM' || String(cause.message || '').indexOf('10013') >= 0) {
    hint =
      '本机出网被拦截（EACCES/10013）。请关掉当前向导窗口，在普通 PowerShell / 资源管理器里运行 deploy.cmd，不要用被沙箱限制的进程。';
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    hint = 'DNS 解析失败，无法解析 api.cloudflare.com。检查网络或设置 HTTPS_PROXY 后重启。';
  } else if (
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    (e && e.name === 'TimeoutError')
  ) {
    hint = '连接 Cloudflare API 超时。国内网络可设置环境变量 HTTPS_PROXY 后重启向导。';
  } else if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    hint = '连接被重置。若走代理，检查 HTTPS_PROXY 是否可达。';
  } else if (e && e.message === 'fetch failed') {
    hint = '无法访问 Cloudflare API。常见原因：沙箱/防火墙拦截、需要代理。';
  } else {
    hint = '访问 Cloudflare API 失败。';
  }
  const err = new Error(hint + ' ' + detail + (url ? ' @ ' + url : ''));
  err.cause = e;
  err.code = code;
  return err;
}

export async function checkCloudflareApi() {
  const url = 'https://api.cloudflare.com/client/v4/user/tokens/verify';
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    return {
      ok: true,
      status: res.status,
      proxy: readProxy() || null,
      preview: text.slice(0, 160),
    };
  } catch (e) {
    const wrapped = wrapNetworkError(e, url);
    return { ok: false, proxy: readProxy() || null, error: wrapped.message, code: wrapped.code || null };
  }
}
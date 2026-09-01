/* Skymail Oneclick — 在已登录的 dash.cloudflare.com 页面 F12 Console 粘贴回车
 * 会按本项目所需权限创建「用户 API Token」，并复制到剪贴板。
 * 失败则跳转官方预填链接；下拉框空着也直接点 Continue to summary。
 */
(async () => {
  const NAME = "Skymail Oneclick";
  const TOKEN_PERMS = [
    { key: "workers_scripts", type: "edit" },
    { key: "workers_kv_storage", type: "edit" },
    { key: "d1", type: "edit" },
    { key: "workers_r2", type: "edit" },
    { key: "account_settings", type: "read" },
    { key: "zone", type: "read" },
    { key: "dns", type: "edit" },
    { key: "workers_routes", type: "edit" },
    { key: "email_routing_rules", type: "edit" },
    { key: "email_routing_settings", type: "edit" },
    { key: "ssl_and_certificates", type: "edit" },
    { key: "zone_settings", type: "edit" }
  ];
  const PREFILL = "https://dash.cloudflare.com/profile/api-tokens?" + new URLSearchParams({
    permissionGroupKeys: JSON.stringify(TOKEN_PERMS),
    accountId: "*",
    zoneId: "all",
    name: NAME
  }).toString();

  const log = function () {
    var args = ["%c[skymail]", "color:#f6821f;font-weight:700"];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  };

  function clickContinue() {
    var nodes = document.querySelectorAll("button,a,[role=button]");
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].innerText || nodes[i].textContent || "").replace(/\s+/g, " ").trim();
      if (/continue to summary|continue to review|继续.*摘要/i.test(t)) {
        nodes[i].click();
        return true;
      }
    }
    return false;
  }

  function cookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[-.]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function nrm(s) {
    return String(s || "").toLowerCase().replace(/write/g, "edit").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function cfError(json, status, text) {
    if (json && json.errors && json.errors.length) {
      return json.errors.map(function (e) { return e.message; }).join("; ");
    }
    return "HTTP " + status + " " + String(text || "").slice(0, 180);
  }

  async function apiOnce(method, path, body, extraHeaders) {
    var headers = { accept: "application/json", "content-type": "application/json" };
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) {
      if (extraHeaders[k]) headers[k] = extraHeaders[k];
    });
    var res = await fetch("/api/v4" + path, {
      method: method,
      credentials: "include",
      cache: "no-store",
      headers: headers,
      body: body == null ? undefined : JSON.stringify(body)
    });
    var text = await res.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) {}
    if (!json || json.success === false) {
      var err = new Error(cfError(json, res.status, text));
      err.status = res.status;
      err.json = json;
      throw err;
    }
    return json;
  }

  async function api(method, path, body) {
    var attempts = [
      {},
      { "x-cross-site-security": "dash" },
      { "x-cross-site-security": "dash", "x-atok": cookie("atok") || cookie("ATOK") }
    ];
    var last = null;
    for (var i = 0; i < attempts.length; i++) {
      try {
        return await apiOnce(method, path, body, attempts[i]);
      } catch (e) {
        last = e;
        if (e.status !== 401 && e.status !== 403 && e.status !== 400) throw e;
      }
    }
    throw last || new Error("Cloudflare API failed");
  }

  async function listAll(path) {
    var out = [];
    var page = 1;
    while (true) {
      var join = path.indexOf("?") >= 0 ? "&" : "?";
      var json = await api("GET", path + join + "page=" + page + "&per_page=50");
      var chunk = Array.isArray(json.result) ? json.result : [];
      out.push.apply(out, chunk);
      var info = json.result_info || {};
      if (page >= (info.total_pages || 1) || chunk.length === 0) break;
      page += 1;
    }
    return out;
  }

  function resourceOf(group) {
    var scopes = group.scopes || group.scope || [];
    if (!Array.isArray(scopes)) scopes = [scopes];
    for (var i = 0; i < scopes.length; i++) {
      var s = String(scopes[i] || "");
      if (s.indexOf("account.zone") >= 0) return "com.cloudflare.api.account.zone.*";
      if (s.indexOf("com.cloudflare.api.user") >= 0) return "com.cloudflare.api.user.*";
    }
    return "com.cloudflare.api.account.*";
  }

  const WANT = [
    ["Workers Scripts Write", ["workers scripts write", "workers scripts edit"]],
    ["Workers KV Storage Write", ["workers kv storage write", "workers kv storage edit", "workers kv write"]],
    ["D1 Write", ["d1 write", "d1 edit", "workers d1 write"]],
    ["Workers R2 Storage Write", ["workers r2 storage write", "workers r2 storage edit", "workers r2 write", "r2 write"]],
    ["Account Settings Read", ["account settings read"]],
    ["Zone Read", ["zone read"]],
    ["DNS Write", ["dns write", "dns edit", "zone dns write"]],
    ["Workers Routes Write", ["workers routes write", "workers routes edit"]],
    ["Email Routing Rules Write", ["email routing rules write", "email routing rules edit"]],
    ["Email Routing Settings Write", ["email routing settings write", "email routing settings edit"]],
    ["SSL and Certificates Write", ["ssl and certificates write", "ssl and certificates edit"]],
    ["Zone Settings Write", ["zone settings write", "zone settings edit"]]
  ];

  function goPrefill(reason) {
    log(reason || "改用官方预填链接");
    if (!/[?&]permissionGroupKeys=/.test(location.search)) {
      location.href = PREFILL;
      return;
    }
    if (clickContinue()) {
      log("已点击 Continue to summary。确认后 Create Token，把值粘回 Skymail 向导。");
      return;
    }
    alert("请点 Continue to summary → Create Token，然后把 Token 粘回 Skymail 向导");
  }

  if (!/(^|\.)dash\.cloudflare\.com$/i.test(location.hostname)) {
    log("请在已登录的 dash.cloudflare.com 标签页运行本脚本。正在打开 Token 页…");
    open("https://dash.cloudflare.com/profile/api-tokens", "_blank");
    alert("在新打开的 Cloudflare 控制台页面再按 F12，把同一段脚本粘贴到 Console 回车。");
    return;
  }

  try {
    log("读取权限组…");
    var groups = await listAll("/user/tokens/permission_groups");
    log("权限组数量", groups.length);
    if (!groups.length) throw new Error("权限组为空，可能未登录");

    var picked = [];
    var missing = [];
    var used = {};
    for (var i = 0; i < WANT.length; i++) {
      var label = WANT[i][0];
      var aliases = WANT[i][1].concat([label]).map(nrm);
      var hit = null;
      for (var g = 0; g < groups.length; g++) {
        if (aliases.indexOf(nrm(groups[g].name)) >= 0) { hit = groups[g]; break; }
      }
      if (!hit) {
        var key = nrm(label).replace(/ edit$/, "");
        var cands = groups.filter(function (x) { return nrm(x.name).indexOf(key) >= 0; });
        if (cands.length === 1) hit = cands[0];
        else if (cands.length) log("多候选", label, cands.map(function (x) { return x.name; }));
      }
      if (hit && !used[hit.id]) {
        used[hit.id] = true;
        picked.push(hit);
        log("✓", hit.name);
      } else if (!hit) {
        missing.push(label);
        log("✗ 未找到", label);
      }
    }

    if (!picked.length) throw new Error("没有匹配到权限组");

    var buckets = {};
    for (var p = 0; p < picked.length; p++) {
      var resKey = resourceOf(picked[p]);
      if (!buckets[resKey]) buckets[resKey] = [];
      buckets[resKey].push({ id: picked[p].id, name: picked[p].name });
    }
    var policies = Object.keys(buckets).map(function (resource) {
      var obj = { effect: "allow", resources: {}, permission_groups: buckets[resource] };
      obj.resources[resource] = "*";
      return obj;
    });

    log("正在创建 Token…", missing.length ? ("缺 " + missing.join(", ")) : "权限齐全");
    var created = await api("POST", "/user/tokens", {
      name: NAME + " " + new Date().toISOString().slice(0, 16).replace("T", " "),
      policies: policies
    });
    var value = created.result && created.result.value;
    if (!value) throw new Error("创建成功但未返回 Token 值");
    log("Token 只会显示一次：");
    console.log(value);
    try {
      await navigator.clipboard.writeText(value);
      log("已复制到剪贴板。回到 Skymail 向导粘贴并验证。");
      alert("Token 已复制。回到 Skymail 向导粘贴验证。");
    } catch (e2) {
      window.prompt("复制这个 Token", value);
    }
  } catch (e) {
    log("API 创建失败：", (e && e.message) || e);
    goPrefill("控制台会话创建 Token 失败，改走预填链接");
  }
})();
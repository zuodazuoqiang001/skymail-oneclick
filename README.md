# Skymail 一键部署

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

开源仓库：[zuodazuoqiang001/skymail-oneclick](https://github.com/zuodazuoqiang001/skymail-oneclick)


把 [Cloud Mail / Skymail](https://doc.skymail.ink/) 部署到 Cloudflare 的本地向导。

官方文档的三种方式（GitHub Action、Cloudflare 控制台、Wrangler 命令行）都能上线 Worker，但 **Email Routing、Catch-all 到 Worker、MX、D1/KV/R2、自定义域、`/api/init`** 仍要来回点控制台。Cloudflare 账号内这些操作都有 API，所以这个工具用 **一个 Token** 把它们串成一键流水线。

Token 只发往 `api.cloudflare.com` 和本机 `wrangler deploy`，不会上传到第三方。

## 你需要提前准备

1. **Node.js 20+**
2. 域名已经接入 Cloudflare（NS 已切过去）
3. 一个 Cloudflare **用户 API Token**（My Profile → API Tokens）。不要用 Account API Token（`cfat_` 开头），本向导也不支持 Global API Key。

Cloudflare **没有「全部权限」自定义 Token**。最快创建方式是官方预填链接（权限已勾好，Account=*，Zone=all）：

在向导第一步点 **一键预填所需权限**，或手动打开：

https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22email_routing_rules%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22email_routing_settings%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22ssl_and_certificates%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=*&zoneId=all&name=Skymail%20Oneclick

打开后如果下拉框看起来是空的，直接点 **Continue to summary** → **Create Token**。这是 Cloudflare 控制台的渲染 bug，权限在摘要页是齐的。

需要的权限：

**Account**
- Workers Scripts: Edit
- Workers KV Storage: Edit
- D1: Edit
- Workers R2 Storage: Edit
- Account Settings: Read

**Zone**（包含要用来收信的域名）
- Zone: Read
- DNS: Edit
- Workers Routes: Edit
- Email Routing Settings: Edit
- Email Routing Rules: Edit
- SSL and Certificates: Edit
- Zone Settings: Edit

备选：用模板 **Edit Cloudflare Workers**，再手动补 Email Routing / DNS / SSL。

建议用 **Free 计划即可**。Email Routing 走 Worker Catch-all，不必再验证转发目标邮箱。

## 最快创建 Token

Cloudflare **没有全选权限**。不要在 Create Custom Token 里一项项点。

### 方法 A：F12 脚本（推荐）

1. 浏览器登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 从本向导复制 **F12 脚本**（`web/assets/cf-token-console.js`）
3. 在 **dash.cloudflare.com** 页面按 F12 → Console → 粘贴回车
4. 成功后 Token 会复制到剪贴板，回到向导验证

脚本用当前登录会话调用 `/api/v4/user/tokens`，只创建本项目需要的用户 API Token，不会上传到第三方。

### 方法 B：官方预填链接

向导里点 **或用官方预填链接**。下拉框空着也没关系，点 Continue to summary → Create Token。

唯一真正「全权限」的是 **Global API Key**（邮箱 + `X-Auth-Key`），风险大，本向导不用它。

## 安装

Windows / macOS / Linux 均可（需要 Node.js 20+）：

```bash
git clone https://github.com/zuodazuoqiang001/skymail-oneclick.git
cd skymail-oneclick
```

## 启动向导


在本目录：

```bat
deploy.cmd
```

或：

```powershell
.\deploy.ps1
```

或：

```bash
node deploy.mjs
# 或 ./deploy.sh
```

浏览器打开 `http://127.0.0.1:8788`：

1. 粘贴 Token，验证账号和域名
2. 勾选邮箱域名，填写站点域名（默认 `mail.example.com`）和管理员邮箱
3. 若该域名以前用 Google / 企业邮箱收信，必须勾选 **覆盖已有 MX**，否则不会改 MX
4. 点一键部署，等 Worker 构建发布、Email Routing Catch-all、数据库 init

完成后用 **管理员邮箱在站点里注册第一个账号**。

向导步骤 2 有 **清空已部署的邮箱**：输入站点/邮箱域名/Worker 名，预览后输入「清空」确认。默认删除 Worker、D1、KV、自定义域，并关闭 Catch-all；MX 需另勾选。

## 命令行

```bash
node deploy.mjs --cli --token <CF_TOKEN> --zone example.com --site mail.example.com --admin admin@example.com --replace-mx
```

多账号时加 `--account <ACCOUNT_ID>`。多个邮箱域名：`--zone a.com,b.com`。不要 R2：`--no-r2`。

## 流水线会做什么

1. 检查 Token 权限
2. 创建或复用 D1 `cloud-mail`、KV `cloud-mail-kv`、R2 `cloud-mail-r2`
3. 使用内置 [maillab/cloud-mail](https://github.com/maillab/cloud-mail) 快照（`vendor/cloud-mail`，MIT）
4. 生成 `wrangler.toml`（域名数组、admin、jwt_secret、自定义域）
5. `pnpm install` + `wrangler deploy`（含 Vue 前端构建）
6. 绑定自定义域
7. 启用 Email Routing，Catch-all 指向该 Worker
8. 访问 `/api/init/{jwt}` 初始化数据库

状态会写到 `.skymail-state.json`（不含 Token，含 jwt，请自己保管）。

## 和官方文档的差异

| 步骤 | 官方 | 这里 |
| --- | --- | --- |
| D1 / KV / R2 | 控制台或 Action Secrets 手填 ID | API 自动创建/复用 |
| Worker + 前端 | Action / 控制台 / wrangler | 自动 clone + deploy |
| 自定义域 | 手绑 | wrangler routes + API |
| Email Routing / MX / Catch-all | **必须手点** | API 自动 |
| 数据库 init | 浏览器打开 `/api/init/密钥` | 部署后自动打 |

源码仍用官方仓库，不维护 fork。Cloud Mail 升级后再跑一次向导即可（同名资源会复用）。

## 注意

- 站点默认绑 `mail.你的域名`，避免把 apex 官网首页抢走。若你就是要用 `example.com` 当邮箱站，把站点域名改成 apex。
- **覆盖 MX 会让该域名不再从原邮箱服务商收信。**
- 若自动 init 因证书未就绪失败，等 1–2 分钟后访问：`https://站点/api/init/你的jwt`
- 登录验证码（Turnstile）若未配置，到后台把站点密钥留空或填自己的 Turnstile。
- 本机需要能访问 GitHub 与 Cloudflare API。没有 git 时会改下 zip。

## 文档

- Skymail 文档：https://doc.skymail.ink/
- 仓库：https://github.com/maillab/cloud-mail

## 排查：克隆失败 git exit 128 / curl 56

这是访问 GitHub 被重置，不是 Token 问题。源码已内置在 `vendor/cloud-mail`，**必须关掉旧的 8788 窗口再运行 deploy.cmd**（只刷新网页还是旧进程）。新进程会直接用本地源码，不再连 github.com。

1. 刷新本机向导后再部署。失败时会自动删除本次新建、且 **尚未发布 Worker** 的 D1 / KV / R2。
2. 若仍克隆失败，给向导进程设置 `HTTPS_PROXY`（和能翻 GitHub 的终端同一代理），再运行 `deploy.cmd`。
3. 步骤 2 若提示上次失败留下的 D1/KV，点 **立即删除**。

## 排查：验证时报 fetch failed

页面上的 `fetch failed` 几乎都是 **向导进程访问不了 api.cloudflare.com**，不是 Token 写错。

1. 关掉占用 8788 的旧窗口，在资源管理器双击 `deploy.cmd` 重新打开（不要用被限制出网的进程）。
2. 启动日志里应出现 `Cloudflare API reachable`。若是 `WARNING Cloudflare API unreachable`，再设 `HTTPS_PROXY`。
3. 浏览器强制刷新 `http://127.0.0.1:8788` 后再点验证。


## 许可

本仓库 MIT。内置的 Cloud Mail 源码见 [NOTICE](NOTICE) 与 `vendor/cloud-mail/LICENSE`。

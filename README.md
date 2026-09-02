<p align="center">
    <img src="logo.png" width="80px" alt="Skymail Oneclick" />
    <h1 align="center">Skymail 一键部署</h1>
    <p align="center">一键把 Cloud Mail / Skymail 域名邮箱部署到 Cloudflare，含 Email Routing Catch-all 🎉</p>
    <p align="center">
        简体中文 | <a href="./README-en.md" style="margin-left: 5px">English</a>
    </p>
    <p align="center">
        <a href="https://github.com/zuodazuoqiang001/skymail-oneclick/issues"><img src="https://img.shields.io/github/issues/zuodazuoqiang001/skymail-oneclick" alt="issues"></a>
        <a href="https://github.com/zuodazuoqiang001/skymail-oneclick"><img src="https://img.shields.io/github/stars/zuodazuoqiang001/skymail-oneclick" alt="stars"></a>
        <a href="https://github.com/zuodazuoqiang001/skymail-oneclick"><img src="https://img.shields.io/github/forks/zuodazuoqiang001/skymail-oneclick" alt="forks"></a>
        <a href="https://github.com/zuodazuoqiang001/skymail-oneclick/blob/main/LICENSE"><img src="https://img.shields.io/github/license/zuodazuoqiang001/skymail-oneclick" alt="license"></a>
        <a href="https://github.com/zuodazuoqiang001/skymail-oneclick/releases"><img src="https://img.shields.io/github/v/release/zuodazuoqiang001/skymail-oneclick?include_prereleases" alt="release"></a>
    </p>
</p>

官方文档的三种方式（GitHub Action、Cloudflare 控制台、Wrangler 命令行）都能上线 Worker，但 **Email Routing、Catch-all 到 Worker、MX、D1/KV/R2、自定义域、`/api/init`** 仍要来回点控制台。Cloudflare 账号内这些操作都有 API，所以这个工具用 **一个 Token** 把它们串成一键流水线。

Token 只发往 `api.cloudflare.com` 和本机 `wrangler deploy`，不会上传到第三方。

## 你需要提前准备

1. **Node.js 22+**（Wrangler 4.87+ 要求。低于 22 时向导会自动下载便携 Node 22）
2. 域名已经接入 Cloudflare（NS 已切过去）
3. 一个 Cloudflare **用户 API Token**（My Profile → API Tokens）。不要用 Account API Token（`cfat_` 开头），本向导也不支持 Global API Key。

Cloudflare **没有「全部权限」自定义 Token**。最快创建方式是官方预填链接（权限已勾好，Account=*，Zone=all）：

在向导第一步点 **一键预填所需权限**，或点击 [Cloudflare 自动创建 Skymail 部署所需 Token](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22email_routing_rules%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22email_routing_settings%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22ssl_and_certificates%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=*&zoneId=all&name=Skymail%20Oneclick)

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

点击 [Cloudflare 自动创建 Skymail 部署所需 Token](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_routes%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22email_routing_rules%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22email_routing_settings%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22ssl_and_certificates%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=*&zoneId=all&name=Skymail%20Oneclick)。下拉框空着也没关系，点 Continue to summary → Create Token。

唯一真正「全权限」的是 **Global API Key**（邮箱 + `X-Auth-Key`），风险大，本向导不用它。

## 安装

Windows / macOS / Linux 均可（需要 Node.js 22+；没有或版本不够时会自动下载便携 Node 22）：

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
3. 从 GitHub 拉取最新 [maillab/cloud-mail](https://github.com/maillab/cloud-mail)（连不上时走镜像 / zip）
4. 生成 `wrangler.toml`（域名数组、admin、jwt_secret、自定义域）
5. 检查 Node 22+（不够则自动升级/下载），自动安装 pnpm 与 `mail-worker` / `mail-vue` 依赖，再构建前端并 `wrangler deploy`
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

## 许可

本仓库 MIT。部署时会从上游 [maillab/cloud-mail](https://github.com/maillab/cloud-mail) 克隆最新源码（MIT），不内置、不维护 fork。

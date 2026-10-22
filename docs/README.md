# UOOC QA Share

UOOC（优课联盟）题库共享平台。集中存储测验题目与答案，供各类插件查询和上传。

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DATABASE_URL、OAuth 密钥等

# 创建数据库（需先安装 PostgreSQL 并创建数据库）
createdb uooc_qa_share
# 启用 pgvector 扩展
psql -d uooc_qa_share -c 'CREATE EXTENSION IF NOT EXISTS vector;'

# 运行数据库迁移
pnpm drizzle-kit push

# 启动开发服务器
pnpm dev
```

## Docker 部署与数据库管理

### 1. 启动服务

```bash
cp .env.example .env
# 编辑 .env 配置相关密钥
docker compose --env-file .env up -d
```

全新部署时，PostgreSQL 容器会自动挂载 `./drizzle` 并通过 `/docker-entrypoint-initdb.d/` 自动完成建表、创建 pgvector 扩展及索引。

### 2. 数据库手动初始化与迁移

如数据库容器已存在但尚未初始化表结构，可直接运行容器内置的初始化脚本：

```bash
docker compose exec db init-db.sh
```

也可以通过标准输入导入迁移 SQL：

```bash
docker compose exec -T db psql -U postgres -d uooc_qa_share < drizzle/0000_dark_apocalypse.sql
```

### 3. 数据备份与恢复

- **备份**：容器默认启动后台备份守护进程（每天 02:00 自动导出题库数据到 `./backups/`）。亦可随时手动触发：
  ```bash
  docker compose exec db backup.sh --now
  ```
- **恢复**：从最新备份或指定备份文件恢复数据：
  ```bash
  # 恢复最新备份 (qa_backup_latest.sql.gz)
  docker compose exec db restore.sh

  # 或指定恢复具体文件
  docker compose exec db restore.sh /backups/qa_backup_20261022_120000.sql.gz
  ```

## 文档

- [API 参考](./api-reference.md) — 完整的 REST API 文档（含自动任务补全、RFC 8628 设备授权、API Key、Webview 注入与鉴权模型）
- [插件接入指南](./plugin-integration.md) — fuckuooc、your-szu-life 等插件的完整接入指南（含无回调地址设备认证、OAuth 预登录、静默匿名申请、账号绑定升级与空闲题库巡检/任务认领）
- [MCP 协议接入指南](./mcp-integration.md) — MCP 协议与 Agent Auth 接入说明（Claude Desktop、Cursor 配置、8 个核心工具、设备流交互及本地试题清洗入库）
- [数据模型](./data-model.md) — 数据库结构、三级去重匹配策略、答案状态机与自动任务模型约定

## 技术栈

- **前端**: Astro + React + shadcn/ui + Tailwind CSS
- **后端**: ElysiaJS (运行在 Astro SSR 内)
- **数据库**: PostgreSQL + Drizzle ORM + pgvector
- **认证**: better-auth (GitHub OAuth / bili-sign OAuth / RFC 8628 设备授权 / 匿名)
- **MCP**: Streamable HTTP 传输协议

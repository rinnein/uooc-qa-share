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

## 文档

- [API 参考](./api-reference.md) — 完整的 REST API 文档
- [插件接入指南](./plugin-integration.md) — fuckuooc、your-szu-life 等插件的接入说明
- [MCP 接入指南](./mcp-integration.md) — MCP 协议接入说明
- [数据模型](./data-model.md) — 数据库结构和字段约定

## 技术栈

- **前端**: Astro + React + shadcn/ui + Tailwind CSS
- **后端**: ElysiaJS (运行在 Astro SSR 内)
- **数据库**: PostgreSQL + Drizzle ORM + pgvector
- **认证**: better-auth (GitHub OAuth / bili-sign OAuth / 匿名)
- **MCP**: Streamable HTTP 传输协议

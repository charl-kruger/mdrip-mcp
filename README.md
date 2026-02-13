# mdrip-mcp

A remote, authless MCP server that exposes [mdrip](https://www.npmjs.com/package/mdrip) — fetch markdown snapshots of web pages optimized for AI agents.

Built on Cloudflare Workers using the [Agents SDK](https://developers.cloudflare.com/agents/) and [Remote MCP Server](https://developers.cloudflare.com/agents/guides/remote-mcp-server/) pattern.

## Tools

### `fetch_markdown`

Fetch a single webpage and convert it to clean markdown using Cloudflare's Markdown for Agents. Returns markdown content with metadata (token count, source method, resolved URL, content signal).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `url` | string (URL) | Yes | The webpage URL to fetch |
| `timeout_ms` | number | No | Request timeout in ms (default: 30000) |
| `html_fallback` | boolean | No | Fall back to HTML conversion if native markdown unavailable (default: true) |

### `batch_fetch_markdown`

Fetch multiple webpages concurrently. Returns results for each URL. Limited to 10 URLs per request.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `urls` | string[] | Yes | Array of URLs (1-10) |
| `timeout_ms` | number | No | Timeout per URL in ms (default: 30000) |
| `html_fallback` | boolean | No | Fall back to HTML conversion (default: true) |

## HTTP API

The worker also exposes a direct JSON API at `https://mdrip.createmcp.dev/api` with CORS enabled.

### `GET /api`

Fetch one URL with query params:

- `url` (required): target URL
- `timeout` (optional): timeout in milliseconds
- `html_fallback` (optional): `true`/`false` (set `false` to disable fallback)

```bash
curl "https://mdrip.createmcp.dev/api?url=https://example.com&timeout=30000&html_fallback=true"
```

### `POST /api`

Single URL body:

```json
{
  "url": "https://example.com",
  "timeout_ms": 30000,
  "html_fallback": true
}
```

Batch body (1-10 URLs):

```json
{
  "urls": [
    "https://example.com",
    "https://example.com/docs"
  ],
  "timeout_ms": 30000,
  "html_fallback": true
}
```

### Response shape

- Single fetch: one JSON object with `url`, `resolvedUrl`, `status`, `contentType`, `source`, `markdownTokens`, `contentSignal`, and `markdown`
- Batch fetch: `{ "results": [...] }`, where each result includes `success: true|false` and either fetch output or an `error`

## Development

```bash
pnpm install
pnpm start
# Server runs at http://localhost:8788
# MCP endpoint at http://localhost:8788/mcp
```

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
# Open http://localhost:5173, enter http://localhost:8788/mcp
```

## Deploy

```bash
pnpm deploy
# Deploys to https://mdrip.createmcp.dev
```

## Connect

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mdrip": {
      "command": "npx",
      "args": ["mcp-remote", "https://mdrip.createmcp.dev/mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add mdrip-remote --transport sse https://mdrip.createmcp.dev/sse
```

### Cloudflare AI Playground

Enter `mdrip.createmcp.dev/sse` at [playground.ai.cloudflare.com](https://playground.ai.cloudflare.com/).

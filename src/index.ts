import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { fetchMarkdown } from "mdrip";
import type { FetchMarkdownOptions, MarkdownResponse } from "mdrip";

export class MdripMCP extends McpAgent {
	server = new McpServer({
		name: "mdrip",
		version: "0.1.0",
	});

	async init() {
		this.server.tool(
			"fetch_markdown",
			"Fetch a webpage and convert it to clean markdown optimized for AI agents using Cloudflare's Markdown for Agents. Returns the markdown content along with metadata (token count, source method, resolved URL, content signal).",
			{
				url: z
					.string()
					.url()
					.describe("The URL of the webpage to fetch as markdown"),
				timeout_ms: z
					.number()
					.int()
					.min(1000)
					.max(120000)
					.optional()
					.describe("Request timeout in milliseconds (default: 30000)"),
				html_fallback: z
					.boolean()
					.optional()
					.describe(
						"Fall back to HTML-to-markdown conversion if native markdown is unavailable (default: true)",
					),
			},
			async ({ url, timeout_ms, html_fallback }) => {
				try {
					const options: FetchMarkdownOptions = {
						userAgent: "mdrip-mcp/0.1.0",
					};
					if (timeout_ms !== undefined) options.timeoutMs = timeout_ms;
					if (html_fallback !== undefined) options.htmlFallback = html_fallback;

					const result = await fetchMarkdown(url, options);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									url,
									resolvedUrl: result.resolvedUrl,
									status: result.status,
									contentType: result.contentType,
									source: result.source,
									markdownTokens: result.markdownTokens,
									contentSignal: result.contentSignal,
								}),
							},
							{
								type: "text",
								text: result.markdown,
							},
						],
					};
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					return {
						content: [
							{ type: "text", text: `Error fetching ${url}: ${message}` },
						],
						isError: true,
					};
				}
			},
		);

		this.server.tool(
			"batch_fetch_markdown",
			"Fetch multiple webpages concurrently and convert them to markdown. Returns results for each URL including markdown content and metadata. Limited to 10 URLs per request.",
			{
				urls: z
					.array(z.string().url())
					.min(1)
					.max(10)
					.describe("Array of URLs to fetch as markdown (1-10 URLs)"),
				timeout_ms: z
					.number()
					.int()
					.min(1000)
					.max(120000)
					.optional()
					.describe(
						"Request timeout per URL in milliseconds (default: 30000)",
					),
				html_fallback: z
					.boolean()
					.optional()
					.describe(
						"Fall back to HTML-to-markdown conversion if native markdown is unavailable (default: true)",
					),
			},
			async ({ urls, timeout_ms, html_fallback }) => {
				const options: FetchMarkdownOptions = {
					userAgent: "mdrip-mcp/0.1.0",
				};
				if (timeout_ms !== undefined) options.timeoutMs = timeout_ms;
				if (html_fallback !== undefined) options.htmlFallback = html_fallback;

				const results = await Promise.allSettled(
					urls.map((url) => fetchMarkdown(url, options)),
				);

				const content = results.map((result, index) => {
					const url = urls[index];

					if (result.status === "fulfilled") {
						const r = result.value;
						return {
							type: "text" as const,
							text: JSON.stringify({
								url,
								success: true,
								resolvedUrl: r.resolvedUrl,
								status: r.status,
								contentType: r.contentType,
								source: r.source,
								markdownTokens: r.markdownTokens,
								contentSignal: r.contentSignal,
								markdown: r.markdown,
							}),
						};
					}

					return {
						type: "text" as const,
						text: JSON.stringify({
							url,
							success: false,
							error:
								result.reason instanceof Error
									? result.reason.message
									: String(result.reason),
						}),
					};
				});

				return { content };
			},
		);
	}
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		},
	});
}

function formatResult(url: string, r: MarkdownResponse) {
	return {
		url,
		resolvedUrl: r.resolvedUrl,
		status: r.status,
		contentType: r.contentType,
		source: r.source,
		markdownTokens: r.markdownTokens,
		contentSignal: r.contentSignal,
		markdown: r.markdown,
	};
}

async function handleApiRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);

	// CORS preflight
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type",
			},
		});
	}

	// GET /api?url=<target>&timeout=<ms>&html_fallback=<bool>
	if (request.method === "GET") {
		const targetUrl = url.searchParams.get("url");
		if (!targetUrl) {
			return jsonResponse({ error: "Missing required 'url' query parameter" }, 400);
		}

		try {
			new URL(targetUrl);
		} catch {
			return jsonResponse({ error: "Invalid URL" }, 400);
		}

		const options: FetchMarkdownOptions = { userAgent: "mdrip-api/0.1.0" };
		const timeout = url.searchParams.get("timeout");
		if (timeout) options.timeoutMs = Number.parseInt(timeout, 10);
		const fallback = url.searchParams.get("html_fallback");
		if (fallback === "false") options.htmlFallback = false;

		try {
			const result = await fetchMarkdown(targetUrl, options);
			return jsonResponse(formatResult(targetUrl, result));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return jsonResponse({ error: message, url: targetUrl }, 502);
		}
	}

	// POST /api { url: "..." } or { urls: ["..."] }
	if (request.method === "POST") {
		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return jsonResponse({ error: "Invalid JSON body" }, 400);
		}

		const options: FetchMarkdownOptions = { userAgent: "mdrip-api/0.1.0" };
		if (typeof body.timeout_ms === "number") options.timeoutMs = body.timeout_ms;
		if (body.html_fallback === false) options.htmlFallback = false;

		// Single URL
		if (typeof body.url === "string") {
			try {
				new URL(body.url);
			} catch {
				return jsonResponse({ error: "Invalid URL" }, 400);
			}

			try {
				const result = await fetchMarkdown(body.url, options);
				return jsonResponse(formatResult(body.url, result));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return jsonResponse({ error: message, url: body.url }, 502);
			}
		}

		// Batch URLs
		if (Array.isArray(body.urls)) {
			const urls = body.urls as string[];
			if (urls.length === 0 || urls.length > 10) {
				return jsonResponse({ error: "urls must contain 1-10 URLs" }, 400);
			}

			for (const u of urls) {
				try {
					new URL(u);
				} catch {
					return jsonResponse({ error: `Invalid URL: ${u}` }, 400);
				}
			}

			const settled = await Promise.allSettled(
				urls.map((u) => fetchMarkdown(u, options)),
			);

			const results = settled.map((result, index) => {
				if (result.status === "fulfilled") {
					return { ...formatResult(urls[index], result.value), success: true };
				}
				return {
					url: urls[index],
					success: false,
					error:
						result.reason instanceof Error
							? result.reason.message
							: String(result.reason),
				};
			});

			return jsonResponse({ results });
		}

		return jsonResponse({ error: "Body must contain 'url' (string) or 'urls' (array)" }, 400);
	}

	return jsonResponse({ error: "Method not allowed" }, 405);
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
			return MdripMCP.serve("/mcp").fetch(request, env, ctx);
		}

		if (url.pathname === "/sse" || url.pathname === "/sse/") {
			return MdripMCP.serve("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/api" || url.pathname === "/api/") {
			return handleApiRequest(request);
		}

		if (url.pathname === "/" || url.pathname === "") {
			return jsonResponse({
				name: "mdrip-mcp",
				version: "0.1.0",
				description:
					"Remote MCP server and API for mdrip — fetch markdown snapshots of web pages optimized for AI agents",
				endpoints: {
					mcp: "/mcp",
					sse: "/sse",
					api: "/api",
				},
				tools: ["fetch_markdown", "batch_fetch_markdown"],
				npm: "https://www.npmjs.com/package/mdrip",
				docs: "https://github.com/charl-kruger/mdrip",
			});
		}

		return new Response("Not found", { status: 404 });
	},
};

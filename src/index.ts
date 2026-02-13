import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { fetchMarkdown } from "mdrip";
import type { FetchMarkdownOptions } from "mdrip";

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

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
			return MdripMCP.serve("/mcp").fetch(request, env, ctx);
		}

		if (url.pathname === "/sse" || url.pathname === "/sse/") {
			return MdripMCP.serve("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/" || url.pathname === "") {
			return new Response(
				JSON.stringify(
					{
						name: "mdrip-mcp",
						version: "0.1.0",
						description:
							"Remote MCP server for mdrip — fetch markdown snapshots of web pages optimized for AI agents",
						endpoints: {
							mcp: "/mcp",
							sse: "/sse",
						},
						tools: ["fetch_markdown", "batch_fetch_markdown"],
						npm: "https://www.npmjs.com/package/mdrip",
					},
					null,
					2,
				),
				{
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		return new Response("Not found", { status: 404 });
	},
};

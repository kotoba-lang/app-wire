// wire.etzhayyim.com — Wire Transfer & Messaging Platform
// Thin-edge dispatcher: business logic in AgentGateway MCP + pod-side LangServer.
// 8 methods: createTransfer / listTransfers / getTransfer / confirmTransfer /
//            createMessage / listMessages / getBalance / getTransferHistory

interface SecretBinding { get(): Promise<string>; }
interface Fetcher { fetch(req: Request): Promise<Response>; }
interface Env {
  ASSETS?: Fetcher;
  DISPATCHER_URL?: string;
  DISPATCHER_INTERNAL_SECRET?: string | SecretBinding;
  APP_NANOID?: string;
  AGENTGATEWAY_MCP_ROUTER_URL?: string;
  MCP_ROUTER_URL?: string;
}
interface ExportedHandler<E> { fetch(req: Request, env: E): Promise<Response>; }

const NSID_PREFIX = "com.etzhayyim.apps.wire.";
const ACTOR_DID = "did:web:wire.etzhayyim.com";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health" || url.pathname === "/_app/meta") {
      return json({
        ok: true,
        actor: ACTOR_DID,
        nanoid: env.APP_NANOID ?? "uzfk8ut0",
        execution: "edge-proxy+agentgateway-mcp+langserver",
        bpmn: "60-apps/etzhayyim-project-wire/bpmn",
        methods: [
          "createTransfer", "listTransfers", "getTransfer", "confirmTransfer",
          "createMessage", "listMessages", "getBalance", "getTransferHistory",
        ],
      });
    }

    const nsid = url.pathname.startsWith("/xrpc/") ? url.pathname.slice("/xrpc/".length) : "";
    if (nsid && req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
          "access-control-max-age": "86400",
        },
      });
    }
    // POST keeps the MCP tools/call transport the SvelteKit BFF used (AGENTGATEWAY_MCP_ROUTER_URL).
    if (nsid && req.method === "POST") {
      const body = await bodyWithQuery(req, url);
      if (body.__invalidJson) return json({ error: "InvalidJson" }, 400);
      return proxyToMcp(req, env, nsid, body);
    }
    if (nsid.startsWith(NSID_PREFIX) && req.method === "GET") {
      const body = await bodyWithQuery(req, url);
      if (body.__invalidJson) return json({ error: "InvalidJson" }, 400);
      return proxyToDispatcher(env, nsid, body);
    }

    if (env.ASSETS) return env.ASSETS.fetch(req);
    return json({ error: "NotFound" }, 404);
  },
} satisfies ExportedHandler<Env>;

async function bodyWithQuery(req: Request, url: URL): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    const text = await req.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : {}; }
    catch { return { __invalidJson: true }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { __invalidJson: true };
    body = parsed as Record<string, unknown>;
  }
  for (const [k, v] of url.searchParams.entries()) {
    if (!(k in body)) body[k] = v;
  }
  return body;
}

async function proxyToMcp(req: Request, env: Env, nsid: string, body: Record<string, unknown>): Promise<Response> {
  const base = env.AGENTGATEWAY_MCP_ROUTER_URL?.trim() || env.MCP_ROUTER_URL?.trim() || "https://mcp.etzhayyim.com/xrpc/com.etzhayyim.mcp.message";
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.set("content-type", "application/json");
  headers.set("x-etzhayyim-bff", "cljs-edge-bff");
  headers.set("x-etzhayyim-xrpc-method", nsid);
  const upstream = await fetch(base.replace(/\/+$/, ""), {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name: nsid, arguments: body } }),
  });
  const text = await upstream.text();
  let payload: unknown = text;
  try { payload = text ? JSON.parse(text) : null; } catch { /* Preserve upstream text. */ }
  if (!upstream.ok) return json({ error: "MCP router request failed", upstream: payload }, upstream.status);
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: string } }).error;
    return json({ error: error?.message ?? "MCP router returned an error", upstream: payload }, 502);
  }
  const result = payload && typeof payload === "object" && "result" in payload ? (payload as { result?: unknown }).result : payload;
  const structured = result && typeof result === "object" && "structuredContent" in result
    ? (result as { structuredContent?: unknown }).structuredContent
    : result;
  return json(structured ?? {});
}

async function proxyToDispatcher(env: Env, nsid: string, body: Record<string, unknown>): Promise<Response> {
  const dispatcherUrl = env.DISPATCHER_URL ?? "https://dispatcher.etzhayyim.com";
  const secret = typeof env.DISPATCHER_INTERNAL_SECRET === "object"
    ? await env.DISPATCHER_INTERNAL_SECRET.get()
    : (env.DISPATCHER_INTERNAL_SECRET ?? "");
  const res = await fetch(`${dispatcherUrl}/xrpc/${nsid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify(body),
  });
  const data = await res.text();
  return new Response(data, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

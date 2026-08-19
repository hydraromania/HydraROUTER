// MCP SSE stream endpoint - alternative to /api/mcp for compatibility
import { NextResponse } from "next/server";
import { getMcpServer } from "@/lib/mcp/server.js";

const server = getMcpServer();
const sessions = new Map();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    return new Response(session.stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const encoder = new TextEncoder();
  const sessionId_new = crypto.randomUUID();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event, data) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch { /* ignore */ }
      };

      send("endpoint", `/api/mcp/message?sessionId=${sessionId_new}`);
      sessions.set(sessionId_new, { send, controller, stream, createdAt: Date.now() });

      const interval = setInterval(() => {
        if (closed) { clearInterval(interval); return; }
        send("ping", JSON.stringify({ t: Date.now() }));
      }, 30000);

      const cleanup = () => {
        closed = true;
        clearInterval(interval);
        sessions.delete(sessionId_new);
        try { controller.close(); } catch { /* ignore */ }
      };
      request.signal?.addEventListener?.("abort", cleanup);
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId || !sessions.has(sessionId)) {
    return NextResponse.json({ error: "Invalid or missing sessionId" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const response = await server.handleRequest(body);
    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
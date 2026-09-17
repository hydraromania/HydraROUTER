import { getLiveRequestsSnapshot, liveRequestsEmitter, clearLiveRequestsHistory, cancelLiveRequest } from "@/lib/liveRequestsTracker";
import { blockModel } from "open-sse/services/combo.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, onSend: null };

  const stream = new ReadableStream({
    async start(controller) {
      const sendSnapshot = () => {
        if (state.closed) return;
        try {
          const snapshot = getLiveRequestsSnapshot();
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
        } catch {
          state.closed = true;
          liveRequestsEmitter.off("change", sendSnapshot);
          clearInterval(state.keepalive);
        }
      };

      state.onSend = sendSnapshot;
      // Send initial snapshot immediately
      sendSnapshot();

      liveRequestsEmitter.on("change", sendSnapshot);

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 15000);
    },

    cancel() {
      state.closed = true;
      if (state.onSend) {
        liveRequestsEmitter.off("change", state.onSend);
      }
      clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE() {
  clearLiveRequestsHistory();
  return Response.json({ success: true, message: "Live request history cleared" });
}

/**
 * Dashboard unstick actions for an in-flight request.
 * - cancel:  abort upstream + move the row to history (client gets 499).
 * - reroute: same abort, PLUS short-block the model so the client's automatic
 *   retry / combo fallback immediately lands on a different model.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, id, targetModel, blockGlobal = false } = body || {};
  if (!id || (action !== "cancel" && action !== "reroute")) {
    return Response.json({ error: "Missing id or invalid action (cancel|reroute)" }, { status: 400 });
  }

  const reason = action === "reroute"
    ? (targetModel ? `Rerouted to ${targetModel} from dashboard` : "Rerouted from dashboard")
    : "Cancelled from dashboard";

  const { found, item } = cancelLiveRequest(id, { reason });
  if (!found) return Response.json({ error: "Request not found or already finished" }, { status: 404 });

  let blockedModel = null;
  if (action === "reroute" && blockGlobal && item.provider && item.model) {
    blockedModel = `${item.provider}/${item.model}`;
    blockModel(blockedModel);
  }

  return Response.json({
    success: true,
    action,
    id,
    targetModel: targetModel || null,
    blockedModel,
    message: targetModel
      ? `Request rerouted directly to ${targetModel}`
      : blockedModel
      ? `${blockedModel} blocked for 10m; retry will pick another model`
      : "Request cancelled",
  });
}

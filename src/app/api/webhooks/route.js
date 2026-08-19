// Webhooks endpoint for 9router
// POST /api/webhooks - register a webhook
// GET  /api/webhooks - list registered webhooks
// DELETE /api/webhooks?id=<id> - delete a webhook

import { NextResponse } from "next/server";
import { getSettings, patchSetting } from "@/lib/localDb.js";

const WEBHOOK_EVENTS = [
  "request.started",
  "request.completed",
  "request.failed",
  "quota.warning",
  "quota.exhausted",
  "provider.health_changed",
  "routing.fallback",
  "routing.model_switched",
  "usage.daily_report",
];

async function getWebhooks() {
  const settings = await getSettings();
  return settings.webhooks || [];
}

async function saveWebhooks(webhooks) {
  await patchSetting("webhooks", webhooks);
}

function validateWebhookPayload(payload) {
  if (!payload.url || typeof payload.url !== "string") {
    return { valid: false, error: "url is required and must be a string" };
  }
  try {
    new URL(payload.url);
  } catch {
    return { valid: false, error: "url must be a valid URL" };
  }
  if (payload.events && !Array.isArray(payload.events)) {
    return { valid: false, error: "events must be an array" };
  }
  if (payload.events) {
    for (const event of payload.events) {
      if (!WEBHOOK_EVENTS.includes(event)) {
        return { valid: false, error: `Invalid event: ${event}. Valid events: ${WEBHOOK_EVENTS.join(", ")}` };
      }
    }
  }
  if (payload.secret && typeof payload.secret !== "string") {
    return { valid: false, error: "secret must be a string" };
  }
  return { valid: true };
}

export async function GET(request) {
  const webhooks = await getWebhooks();
  return NextResponse.json({
    webhooks: webhooks.map(w => ({
      id: w.id,
      url: w.url,
      events: w.events || WEBHOOK_EVENTS,
      secret: w.secret ? "***" : undefined,
      createdAt: w.createdAt,
      lastTriggered: w.lastTriggered,
      failureCount: w.failureCount || 0,
    })),
    availableEvents: WEBHOOK_EVENTS,
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const validation = validateWebhookPayload(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const webhooks = await getWebhooks();
    const newWebhook = {
      id: crypto.randomUUID(),
      url: body.url,
      events: body.events || WEBHOOK_EVENTS,
      secret: body.secret || null,
      createdAt: new Date().toISOString(),
      lastTriggered: null,
      failureCount: 0,
    };

    webhooks.push(newWebhook);
    await saveWebhooks(webhooks);

    return NextResponse.json({
      id: newWebhook.id,
      url: newWebhook.url,
      events: newWebhook.events,
      createdAt: newWebhook.createdAt,
    }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id parameter is required" }, { status: 400 });
  }

  const webhooks = await getWebhooks();
  const filtered = webhooks.filter(w => w.id !== id);

  if (filtered.length === webhooks.length) {
    return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  }

  await saveWebhooks(filtered);
  return NextResponse.json({ success: true });
}

// Internal function to trigger webhooks (called from other parts of the codebase)
export async function triggerWebhook(event, payload) {
  const webhooks = await getWebhooks();
  const relevant = webhooks.filter(w => w.events.includes(event));

  for (const webhook of relevant) {
    try {
      const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
      const headers = { "Content-Type": "application/json" };

      if (webhook.secret) {
        const crypto = await import("crypto");
        const signature = crypto.createHmac("sha256", webhook.secret).update(body).digest("hex");
        headers["X-9Router-Signature"] = signature;
      }

      const response = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Update last triggered
      webhook.lastTriggered = new Date().toISOString();
      webhook.failureCount = 0;
    } catch (e) {
      webhook.failureCount = (webhook.failureCount || 0) + 1;
      console.error(`[Webhook] Failed to trigger ${webhook.url} for ${event}:`, e.message);
    }
  }

  // Persist updated webhooks
  await saveWebhooks(webhooks);
}
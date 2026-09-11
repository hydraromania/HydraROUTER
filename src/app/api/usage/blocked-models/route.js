import { getBlockedModels, unblockModel, clearAllModelBlocks } from "open-sse/services/combo.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

export async function GET() {
  try {
    const blockedModels = getBlockedModels();
    return Response.json({ blockedModels });
  } catch (error) {
    console.error("[BlockedModels API] Error:", error);
    return Response.json(
      { error: "Failed to fetch blocked models" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, model } = body;
    
    if (action === "unblock" && model) {
      const success = unblockModel(model);
      return Response.json({ success, message: success ? "Model unblocked" : "Model not found" });
    }
    
    if (action === "clearAll") {
      clearAllModelBlocks();
      return Response.json({ success: true, message: "All model blocks cleared" });
    }
    
    return Response.json(
      { error: "Invalid action" },
      { status: HTTP_STATUS.BAD_REQUEST }
    );
  } catch (error) {
    console.error("[BlockedModels API] Error:", error);
    return Response.json(
      { error: "Failed to process request" },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
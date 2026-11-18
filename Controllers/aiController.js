const { logAudit } = require("../Utils/auditLogger");

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || "erp-ai-internal-secret-key-359";

/**
 * Builds secure server-to-server forwarding headers with authenticated user context.
 */
const buildAiHeaders = (req) => {
  return {
    "Content-Type": "application/json",
    "X-Internal-Service-Key": INTERNAL_SERVICE_KEY,
    "X-User-Id": String(req.user?.id || req.user?._id || ""),
    "X-User-Name": req.user?.name || "Employee",
    "X-User-Email": req.user?.email || "",
    "X-User-Role": req.user?.roleName || "EMPLOYEE",
    "X-Assigned-Warehouses": JSON.stringify(req.user?.assignedWarehouses || []),
  };
};

/**
 * 1. AI Conversational Query Gateway
 */
const chat = async (req, res, next) => {
  try {
    const { query, thread_id } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, message: "Query text is required." });
    }

    const aiRes = await fetch(`${AI_SERVICE_URL}/api/chat`, {
      method: "POST",
      headers: buildAiHeaders(req),
      body: JSON.stringify({ query: query.trim(), thread_id }),
    });

    if (!aiRes.ok) {
      const errData = await aiRes.json().catch(() => ({ detail: "AI Service error" }));
      return res.status(aiRes.status).json({
        success: false,
        message: errData.detail || "Failed to communicate with AI orchestration engine.",
      });
    }

    const data = await aiRes.json();

    // Audit query logging
    await logAudit({
      employeeId: req.user?.id,
      action: "AI_QUERY_EXECUTED",
      entityType: "AI_ASSISTANT",
      description: `User query: "${query.slice(0, 60)}" | Tools: ${data.tools_executed?.join(", ") || "None"}`,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        thread_id: data.thread_id,
        response: data.response,
        intent: data.intent,
        tools_executed: data.tools_executed,
        citations: data.citations,
      },
    });
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.cause?.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        message: "The InventoryPro AI Python service (Port 8000) is currently offline. Please ensure the FastAPI service is running.",
      });
    }
    next(error);
  }
};

/**
 * 2. List User Conversations
 */
const listConversations = async (req, res, next) => {
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/api/conversations`, {
      headers: buildAiHeaders(req),
    });

    if (!aiRes.ok) {
      return res.status(aiRes.status).json({ success: false, message: "Could not fetch conversation history." });
    }

    const data = await aiRes.json();
    res.json(data);
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.cause?.code === "ECONNREFUSED") {
      return res.json({ success: true, data: [] });
    }
    next(error);
  }
};

/**
 * 3. Get Conversation Turns
 */
const getConversation = async (req, res, next) => {
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/api/conversations/${req.params.id}`, {
      headers: buildAiHeaders(req),
    });

    if (!aiRes.ok) {
      return res.status(aiRes.status).json({ success: false, message: "Conversation not found." });
    }

    const data = await aiRes.json();
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Delete Conversation
 */
const deleteConversation = async (req, res, next) => {
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/api/conversations/${req.params.id}`, {
      method: "DELETE",
      headers: buildAiHeaders(req),
    });

    const data = await aiRes.json().catch(() => ({ success: true }));
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * 5. List RAG Documents
 */
const listDocuments = async (req, res, next) => {
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/api/documents`, {
      headers: buildAiHeaders(req),
    });

    if (!aiRes.ok) {
      return res.status(aiRes.status).json({ success: false, message: "Could not fetch document index." });
    }

    const data = await aiRes.json();
    res.json(data);
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.cause?.code === "ECONNREFUSED") {
      return res.json({ success: true, data: [] });
    }
    next(error);
  }
};

/**
 * 6. Upload Company SOP / Policy Document
 */
const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "File upload is required." });
    }

    // Use native Web FormData & Blob compatible with Node.js 18+ native fetch
    const formData = new FormData();
    const fileBlob = new Blob([req.file.buffer], {
      type: req.file.mimetype || "application/octet-stream",
    });
    formData.append("file", fileBlob, req.file.originalname);
    if (req.body.allowed_roles) {
      formData.append("allowed_roles", req.body.allowed_roles);
    }

    const headers = {
      "X-Internal-Service-Key": INTERNAL_SERVICE_KEY,
      "X-User-Id": String(req.user?.id || req.user?._id || ""),
      "X-User-Name": req.user?.name || "Employee",
      "X-User-Email": req.user?.email || "",
      "X-User-Role": req.user?.roleName || "EMPLOYEE",
      "X-Assigned-Warehouses": JSON.stringify(req.user?.assignedWarehouses || []),
    };

    const aiRes = await fetch(`${AI_SERVICE_URL}/api/documents/upload`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!aiRes.ok) {
      const errData = await aiRes.json().catch(() => ({ detail: "Upload failed." }));
      return res.status(aiRes.status).json({
        success: false,
        message: errData.detail || "Document indexing failed in AI knowledgebase.",
      });
    }

    const data = await aiRes.json();

    await logAudit({
      employeeId: req.user?.id || req.user?._id,
      action: "AI_DOCUMENT_UPLOADED",
      entityType: "RAG_KNOWLEDGEBASE",
      description: `Uploaded company SOP '${req.file.originalname}' into ChromaDB knowledgebase`,
      ipAddress: req.ip,
    });

    res.json(data);
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.cause?.code === "ECONNREFUSED") {
      return res.status(503).json({
        success: false,
        message: "The InventoryPro AI Python service (Port 8000) is currently offline. Please ensure the FastAPI service is running.",
      });
    }
    next(error);
  }
};

/**
 * 7. Delete Document
 */
const deleteDocument = async (req, res, next) => {
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/api/documents/${req.params.id}`, {
      method: "DELETE",
      headers: buildAiHeaders(req),
    });

    const data = await aiRes.json().catch(() => ({ success: true }));
    res.json(data);
  } catch (error) {
    next(error);
  }
};

/**
 * 8. AI Service Health Status
 */
const health = async (req, res, next) => {
  try {
    const aiRes = await fetch(`${AI_SERVICE_URL}/health`);
    const data = await aiRes.json();
    res.json({ success: true, ai_service: data });
  } catch (error) {
    res.json({
      success: false,
      ai_service: { status: "offline", error: "Could not connect to AI microservice at " + AI_SERVICE_URL },
    });
  }
};

module.exports = {
  chat,
  listConversations,
  getConversation,
  deleteConversation,
  listDocuments,
  uploadDocument,
  deleteDocument,
  health,
};


const router = require("express").Router();
const multer = require("multer");
const c = require("../Controllers/aiController");
const authorize = require("../Middleware/roleMiddleware");
const { ROLES } = authorize;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max document size
});

// AI Health status
router.get("/health", c.health);

// AI Conversational Chat
router.post(
  "/chat",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.PURCHASE_MANAGER,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.chat
);

// Conversation Threads Management
router.get("/conversations", c.listConversations);
router.get("/conversations/:id", c.getConversation);
router.delete("/conversations/:id", c.deleteConversation);

// RAG Company Document Knowledgebase
router.get("/documents", c.listDocuments);
router.post(
  "/documents/upload",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.PURCHASE_MANAGER,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  upload.single("file"),
  c.uploadDocument
);
router.delete(
  "/documents/:id",
  authorize(ROLES.SUPER_ADMIN),
  c.deleteDocument
);

module.exports = router;


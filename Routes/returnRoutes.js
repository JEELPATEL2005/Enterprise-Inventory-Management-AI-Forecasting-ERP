const router = require("express").Router();
const c = require("../Controllers/returnController");
const authorize = require("../Middleware/roleMiddleware");
const { ROLES } = authorize;

// Return View: Super Admin, Sales Manager, Warehouse Manager, Purchase Manager
router.get(
  "/",
  authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER, ROLES.WAREHOUSE_MANAGER, ROLES.PURCHASE_MANAGER),
  c.list
);
router.get(
  "/:id",
  authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER, ROLES.WAREHOUSE_MANAGER, ROLES.PURCHASE_MANAGER),
  c.get
);

// Return Request Management: Super Admin, Sales Manager (RMA), Warehouse Manager (Debit Notes), Purchase Manager
router.post(
  "/",
  authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER, ROLES.WAREHOUSE_MANAGER, ROLES.PURCHASE_MANAGER),
  c.create
);

// RMA Approval: Super Admin and Sales Manager
router.put("/:id/approve", authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER), c.approve);
router.patch("/:id/approve", authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER), c.approve);

// Physical Dock Receiving: Super Admin and Warehouse Manager
router.put("/:id/receive", authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER), c.receive);
router.patch("/:id/receive", authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER), c.receive);

// Physical 4-Tier Inspection: Warehouse Manager and Super Admin
router.put("/:id/inspect", authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER), c.inspect);
router.patch("/:id/inspect", authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER), c.inspect);

// RMA Resolution (Refund or Replacement): Super Admin and Sales Manager
router.put("/:id/resolve", authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER), c.resolve);
router.patch("/:id/resolve", authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER), c.resolve);

// Status Transitions: Super Admin, Sales Manager, and Warehouse Manager (for receiving/inspecting)
router.put(
  "/:id/status",
  authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER, ROLES.WAREHOUSE_MANAGER),
  c.updateStatus
);
router.patch(
  "/:id/status",
  authorize(ROLES.SUPER_ADMIN, ROLES.SALES_MANAGER, ROLES.WAREHOUSE_MANAGER),
  c.updateStatus
);

// Completion / Outward Dispatch / Restocking: Super Admin, Warehouse Manager, Sales Manager
router.put(
  "/:id/complete",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER, ROLES.SALES_MANAGER),
  c.complete
);
router.patch(
  "/:id/complete",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER, ROLES.SALES_MANAGER),
  c.complete
);

module.exports = router;


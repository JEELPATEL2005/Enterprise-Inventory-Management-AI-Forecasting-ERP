const router = require("express").Router();
const c = require("../Controllers/purchaseController");
const authorize = require("../Middleware/roleMiddleware");
const { ROLES } = authorize;

// Public Vendor Response Endpoints (Phase 7.4 - No Login Required)
router.get("/vendor-response/:token", c.getVendorResponseByToken);
router.post("/vendor-response/:token", c.submitVendorResponse);

// View Purchase Orders
router.get(
  "/",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER, ROLES.WAREHOUSE_MANAGER, ROLES.SALES_MANAGER),
  c.list
);

router.get(
  "/:id",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER, ROLES.WAREHOUSE_MANAGER, ROLES.SALES_MANAGER),
  c.get
);

// Manage / Create / Approve / Cancel POs: Super Admin & Purchase Manager only
router.post(
  "/",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER),
  c.create
);

router.put(
  "/:id/approve",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER),
  c.approve
);

router.post(
  "/:id/send-email",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER),
  c.sendEmail
);

router.post(
  "/:id/email",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER),
  c.sendEmail
);

router.put(
  "/:id/cancel",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER),
  c.cancel
);

// Receiving goods against PO: Super Admin, Purchase Manager, Warehouse Manager
router.put(
  "/:id/receive",
  authorize(ROLES.SUPER_ADMIN, ROLES.PURCHASE_MANAGER, ROLES.WAREHOUSE_MANAGER),
  c.receive
);

module.exports = router;

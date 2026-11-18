const router = require("express").Router();
const c = require("../Controllers/warehouseController");
const authorize = require("../Middleware/roleMiddleware");
const { ROLES } = authorize;

router.get(
  "/",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.PURCHASE_MANAGER,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.list
);

router.get(
  "/:id/performance",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.getPerformance
);

router.get(
  "/:id",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.PURCHASE_MANAGER,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.get
);

// Only Super Admin can mutate warehouse facilities and reassign managers
router.post("/", authorize(ROLES.SUPER_ADMIN), c.create);
router.put("/:id/assign-manager", authorize(ROLES.SUPER_ADMIN), c.assignManager);
router.put("/:id", authorize(ROLES.SUPER_ADMIN), c.update);
router.delete("/:id", authorize(ROLES.SUPER_ADMIN), c.remove);

module.exports = router;

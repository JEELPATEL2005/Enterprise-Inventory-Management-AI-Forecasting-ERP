const router = require("express").Router();
const c = require("../Controllers/inventoryController");
const authorize = require("../Middleware/roleMiddleware");
const { ROLES } = authorize;

// View inventory: Super Admin, Warehouse Manager, Purchase Manager, Sales Manager, Central Operations Manager
router.get(
  "/",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.PURCHASE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.list
);

router.get(
  "/warehouse/:warehouseId",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.PURCHASE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.getByWarehouse
);

router.get(
  "/warehouse/:warehouseId/product/:productId",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.PURCHASE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.getByWarehouseProduct
);

router.get(
  "/:id",
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.WAREHOUSE_MANAGER,
    ROLES.PURCHASE_MANAGER,
    ROLES.SALES_MANAGER,
    ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
  ),
  c.get
);

// Only Super Admin and Warehouse Manager can perform direct physical stock operations
router.post(
  "/stock-in",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER),
  c.stockIn
);

router.post(
  "/stock-out",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER),
  c.stockOut
);

router.post(
  "/adjust",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER),
  c.adjust
);

router.put(
  "/:id/adjust",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER),
  c.adjust
);

router.post(
  "/damaged",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER),
  c.recordDamaged
);

router.put(
  "/",
  authorize(ROLES.SUPER_ADMIN, ROLES.WAREHOUSE_MANAGER),
  c.upsert
);

module.exports = router;

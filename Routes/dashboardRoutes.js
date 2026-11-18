const router = require("express").Router();
const c = require("../Controllers/dashboardController");

router.get("/", c.getDashboard);
router.get("/stats", c.getDashboard);
router.get("/summary", c.getDashboard);
router.get("/warehouse/:id", c.getWarehouseDashboard);

module.exports = router;

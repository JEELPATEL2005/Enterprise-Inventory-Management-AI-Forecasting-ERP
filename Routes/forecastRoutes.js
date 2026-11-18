const router = require("express").Router();
const forecastController = require("../Controllers/forecastController");
const authorize = require("../Middleware/roleMiddleware");
const { ROLES } = authorize;

const ALL_FORECAST_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.PURCHASE_MANAGER,
  ROLES.WAREHOUSE_MANAGER,
  ROLES.SALES_MANAGER,
  ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER,
];

const TRAINING_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.WAREHOUSE_MANAGER,
  ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER,
  ROLES.PURCHASE_MANAGER,
];

// 1. Service health check
router.get("/health", forecastController.getServiceHealth);

// 2. Predict demand (7, 15, or 30 days)
router.post(
  "/predict",
  authorize(...ALL_FORECAST_ROLES),
  forecastController.predictDemand
);

// 3. Trigger model retraining
router.post(
  "/train",
  authorize(...TRAINING_ROLES),
  forecastController.trainModels
);

// 4. View model evaluation metrics (MAE, RMSE, WAPE vs baseline)
router.get(
  "/metrics",
  authorize(...ALL_FORECAST_ROLES),
  forecastController.getModelMetrics
);

// 5. Query prediction history
router.get(
  "/history",
  authorize(...ALL_FORECAST_ROLES),
  forecastController.getForecastHistory
);

// 6. Get latest forecast for a specific product
router.get(
  "/product/:productId",
  authorize(...ALL_FORECAST_ROLES),
  forecastController.getProductForecast
);

module.exports = router;


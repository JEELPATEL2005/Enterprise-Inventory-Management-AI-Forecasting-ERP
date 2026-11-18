const ForecastHistory = require("../Models/ForecastHistory");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8001";
const ML_SERVICE_KEY = process.env.ML_SERVICE_KEY || process.env.INTERNAL_SERVICE_KEY || "erp-ai-internal-secret-key-359";

/**
 * Builds authorization headers for secure microservice-to-microservice communication.
 */
const buildHeaders = () => ({
  "Content-Type": "application/json",
  "X-Internal-Key": ML_SERVICE_KEY,
});

/**
 * 1. Health check of Python ML Microservice
 */
const checkHealth = async () => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/health`, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { status: "offline", service: "ml-forecasting", database_connected: false };
    }
    return await response.json();
  } catch (error) {
    return {
      status: "offline",
      service: "ml-forecasting",
      error: error.message,
      database_connected: false,
    };
  }
};

/**
 * 2. Trigger model training
 */
const trainModels = async ({ productId = null, warehouseId = null, forceRetrain = false }) => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/train`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        product_id: productId,
        warehouse_id: warehouseId,
        force_retrain: forceRetrain,
      }),
      signal: AbortSignal.timeout(60000), // Training can take time
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "Unknown ML service training error" }));
      throw new Error(err.detail || "ML service failed to train model");
    }

    return await response.json();
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error("Model training request timed out after 60 seconds.");
    }
    throw error;
  }
};

/**
 * 3. Generate demand prediction
 */
const predictDemand = async ({ productId, warehouseId = null, horizonDays = 7, user = null }) => {
  if (!productId) {
    throw new Error("Product ID is required to generate forecast.");
  }

  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/predict`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        product_id: productId,
        warehouse_id: warehouseId || null,
        horizon_days: Number(horizonDays) || 7,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: "ML service prediction error" }));
      throw new Error(err.detail || "Failed to generate demand prediction from ML service.");
    }

    const prediction = await response.json();
    return prediction;
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error("Prediction engine timed out. Please try again.");
    }
    throw error;
  }
};

/**
 * 4. Fetch performance metrics across all models
 */
const getModelMetrics = async () => {
  try {
    const response = await fetch(`${ML_SERVICE_URL}/api/ml/metrics`, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error("Failed to retrieve model metrics from ML service.");
    }
    return await response.json();
  } catch (error) {
    throw error;
  }
};

/**
 * 5. Fetch forecast history from MongoDB
 */
const getForecastHistory = async ({ productId = null, warehouseId = null, limit = 20 }) => {
  const query = {};
  if (productId) query.product = productId;
  if (warehouseId) query.warehouse = warehouseId;

  return await ForecastHistory.find(query)
    .populate("product", "productName sku category leadTimeDays safetyStock unit")
    .populate("warehouse", "warehouseName location")
    .populate("generatedBy", "name email")
    .sort({ createdAt: -1 })
    .limit(Number(limit) || 20);
};

/**
 * 6. Fetch latest single forecast from MongoDB
 */
const getLatestForecast = async (productId, warehouseId = null) => {
  const query = { product: productId };
  if (warehouseId) query.warehouse = warehouseId;

  return await ForecastHistory.findOne(query)
    .populate("product", "productName sku category leadTimeDays safetyStock unit")
    .populate("warehouse", "warehouseName location")
    .sort({ createdAt: -1 });
};

module.exports = {
  checkHealth,
  trainModels,
  predictDemand,
  getModelMetrics,
  getForecastHistory,
  getLatestForecast,
};

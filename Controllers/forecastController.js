const mlForecastService = require("../services/mlForecastService");
const { checkWarehouseAccess } = require("../Middleware/warehouseAuthMiddleware");
const { logAudit } = require("../Utils/auditLogger");

/**
 * 1. Generate Demand Forecast (7, 15, or 30 days)
 */
const predictDemand = async (req, res, next) => {
  try {
    const { productId, warehouseId, horizonDays = 7 } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required to generate demand forecast.",
      });
    }

    const horizon = Number(horizonDays);
    if (![7, 15, 30].includes(horizon)) {
      return res.status(400).json({
        success: false,
        message: "Horizon days must be one of [7, 15, 30].",
      });
    }

    // Warehouse access check if warehouse-specific prediction requested
    if (warehouseId) {
      const authResult = await checkWarehouseAccess(req.user, warehouseId);
      if (!authResult.allowed) {
        return res.status(authResult.status || 403).json({
          success: false,
          message: authResult.message || "Unauthorized access to this warehouse.",
        });
      }
    }

    const forecast = await mlForecastService.predictDemand({
      productId,
      warehouseId,
      horizonDays: horizon,
      user: req.user,
    });

    // Audit log
    await logAudit({
      employeeId: req.user?.id || req.user?._id,
      action: "DEMAND_FORECAST_GENERATED",
      details: {
        productId,
        warehouseId: warehouseId || "GLOBAL",
        horizonDays: horizon,
        modelType: forecast.model_type,
        predictedDemand: forecast.total_predicted_demand,
      },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      data: forecast,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 2. Retrain Forecast Models
 */
const trainModels = async (req, res, next) => {
  try {
    const { productId, warehouseId, forceRetrain = false } = req.body;

    if (warehouseId) {
      const authResult = await checkWarehouseAccess(req.user, warehouseId);
      if (!authResult.allowed) {
        return res.status(authResult.status || 403).json({
          success: false,
          message: authResult.message || "Unauthorized access to this warehouse.",
        });
      }
    }

    const result = await mlForecastService.trainModels({
      productId,
      warehouseId,
      forceRetrain,
    });

    await logAudit({
      employeeId: req.user?.id || req.user?._id,
      action: "DEMAND_FORECAST_MODEL_TRAINED",
      details: {
        productId: productId || "ALL",
        warehouseId: warehouseId || "ALL",
        modelsTrained: result.models_trained,
      },
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 3. Fetch Evaluation Metrics (MAE, RMSE, WAPE vs Baseline)
 */
const getModelMetrics = async (req, res, next) => {
  try {
    const metrics = await mlForecastService.getModelMetrics();
    return res.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 4. Retrieve Prediction History from MongoDB
 */
const getForecastHistory = async (req, res, next) => {
  try {
    const { productId, warehouseId, limit = 20 } = req.query;

    if (warehouseId) {
      const authResult = await checkWarehouseAccess(req.user, warehouseId);
      if (!authResult.allowed) {
        return res.status(authResult.status || 403).json({
          success: false,
          message: authResult.message || "Unauthorized access to this warehouse.",
        });
      }
    }

    const history = await mlForecastService.getForecastHistory({
      productId,
      warehouseId,
      limit,
    });

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 5. Get Latest Forecast for a Specific Product
 */
const getProductForecast = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { warehouseId } = req.query;

    if (warehouseId) {
      const authResult = await checkWarehouseAccess(req.user, warehouseId);
      if (!authResult.allowed) {
        return res.status(authResult.status || 403).json({
          success: false,
          message: authResult.message || "Unauthorized access to this warehouse.",
        });
      }
    }

    const forecast = await mlForecastService.getLatestForecast(productId, warehouseId);
    if (!forecast) {
      return res.status(404).json({
        success: false,
        message: "No forecast found for this product. You can generate a new one.",
      });
    }

    return res.status(200).json({
      success: true,
      data: forecast,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * 6. Get Microservice Health
 */
const getServiceHealth = async (req, res, next) => {
  try {
    const health = await mlForecastService.checkHealth();
    return res.status(200).json({
      success: true,
      data: health,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  predictDemand,
  trainModels,
  getModelMetrics,
  getForecastHistory,
  getProductForecast,
  getServiceHealth,
};


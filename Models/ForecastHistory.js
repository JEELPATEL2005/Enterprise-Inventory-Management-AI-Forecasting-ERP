const mongoose = require("mongoose");

const dailyForecastItemSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
    },
    dayIndex: {
      type: Number,
      required: true,
    },
    predictedQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const historicalSalesItemSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
    },
    actualQuantity: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const forecastHistorySchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
      index: true,
    },

    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
      index: true,
    },

    horizonDays: {
      type: Number,
      required: [true, "Forecast horizon in days is required"],
      enum: [7, 15, 30],
    },

    forecastDate: {
      type: Date,
      default: Date.now,
      index: true,
    },

    predictedDemand: {
      type: Number,
      required: true,
      min: 0,
    },

    dailyForecasts: [dailyForecastItemSchema],

    historicalSalesData: [historicalSalesItemSchema],

    modelDetails: {
      modelType: {
        type: String,
        enum: ["XGBoost", "MovingAverageBaseline", "Fallback"],
        default: "XGBoost",
      },
      modelVersion: {
        type: String,
        default: "1.0.0",
      },
      featuresUsed: [String],
      metrics: {
        mae: { type: Number, default: null },
        rmse: { type: Number, default: null },
        wape: { type: Number, default: null },
        baselineMae: { type: Number, default: null },
        baselineRmse: { type: Number, default: null },
        baselineWape: { type: Number, default: null },
      },
    },

    inventorySnapshot: {
      currentPhysicalStock: { type: Number, default: 0 },
      reservedStock: { type: Number, default: 0 },
      availableStock: { type: Number, default: 0 },
      confirmedIncomingStock: { type: Number, default: 0 },
      leadTimeDays: { type: Number, default: 7 },
      safetyStock: { type: Number, default: 0 },
      expectedFutureStock: { type: Number, default: 0 },
      reorderPoint: { type: Number, default: 0 },
      suggestedReorderQuantity: { type: Number, default: 0 },
      isReorderRecommended: { type: Boolean, default: false },
    },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },

    status: {
      type: String,
      enum: ["SUCCESS", "FALLBACK_INSUFFICIENT_HISTORY", "ERROR"],
      default: "SUCCESS",
    },

    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying latest forecasts by product & warehouse
forecastHistorySchema.index({ product: 1, warehouse: 1, createdAt: -1 });

module.exports = mongoose.model("ForecastHistory", forecastHistorySchema);

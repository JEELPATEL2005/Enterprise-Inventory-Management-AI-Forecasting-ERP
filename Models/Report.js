const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: [
        "INVENTORY",
        "PURCHASE",
        "SALES",
        "STOCK_TRANSFER",
        "VENDOR",
        "WAREHOUSE",
        "FINANCIAL",
      ],
      required: true,
    },

    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },

    generatedDate: {
      type: Date,
      default: Date.now,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Generated date cannot be in the future.",
      },
    },

    periodStart: {
      type: Date,
    },

    periodEnd: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          if (this.periodStart && v < this.periodStart) return false;
          return true;
        },
        message: "periodEnd cannot be earlier than periodStart.",
      },
    },

    fileUrl: {
      type: String,
    },

    status: {
      type: String,
      enum: ["GENERATING", "COMPLETED", "FAILED"],
      default: "GENERATING",
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Report", reportSchema);

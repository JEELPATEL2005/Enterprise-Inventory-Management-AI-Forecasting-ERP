const mongoose = require("mongoose");

const stockTransferSchema = new mongoose.Schema(
  {
    sourceWarehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    destinationWarehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    transferDate: {
      type: Date,
      default: Date.now,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Transfer date cannot be in the future.",
      },
    },
    expectedArrivalDate: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          if (this.isModified && !this.isModified("expectedArrivalDate")) return true;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return v >= today;
        },
        message: "Expected arrival date cannot be in the past.",
      },
    },

    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
        },

        receivedQuantity: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],

    status: {
      type: String,
      enum: [
        "REQUESTED",
        "APPROVED",
        "IN_TRANSIT",
        "COMPLETED",
        "REJECTED",
        "CANCELLED",
      ],
      default: "REQUESTED",
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },

    completedAt: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Completion timestamp cannot be in the future.",
      },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("StockTransfer", stockTransferSchema);

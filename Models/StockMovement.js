const mongoose = require("mongoose");

const stockMovementSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },

    type: {
      type: String,
      enum: [
        "STOCK_IN",
        "STOCK_OUT",
        "ADJUSTMENT",
        "TRANSFER_IN",
        "TRANSFER_OUT",
        "RETURN_IN",
        "RETURN_OUT",
        "DAMAGED",
        "SALES_RETURN_GOOD",
        "SALES_RETURN_DAMAGED",
        "SALES_RETURN_REPAIR",
        "SALES_RETURN_REJECTED",
        "PURCHASE_RETURN",
      ],
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
    },

    referenceType: {
      type: String,
      enum: ["PURCHASE", "SALE", "TRANSFER", "RETURN", "ADJUSTMENT", "MANUAL"],
      default: "MANUAL",
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    previousQuantity: {
      type: Number,
      required: true,
    },

    newQuantity: {
      type: Number,
      required: true,
    },

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: false,
    },

    remarks: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual aliases according to specification
stockMovementSchema.virtual("productId").get(function () {
  return this.product;
});

stockMovementSchema.virtual("warehouseId").get(function () {
  return this.warehouse;
});

stockMovementSchema.virtual("movementType").get(function () {
  return this.type;
});

stockMovementSchema.virtual("timestamp").get(function () {
  return this.createdAt;
});

module.exports = mongoose.model("StockMovement", stockMovementSchema);

const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    requestedQuantity: { type: Number, min: 1 },
    approvedQuantity: { type: Number, default: 0, min: 0 },
    rejectedQuantity: { type: Number, default: 0, min: 0 },
    orderedQuantity: { type: Number, default: 0, min: 0 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
    remainingQuantity: { type: Number, default: 0, min: 0 },
    estimatedUnitPrice: { type: Number, min: 0, default: 0 },
    reason: { type: String, trim: true, default: "Low stock" },
    remarks: { type: String, trim: true },
    itemStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "ORDERED", "COMPLETED"],
      default: "PENDING",
    },
  },
  {
    _id: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

itemSchema.virtual("productId").get(function () {
  return this.product;
});

itemSchema.pre("validate", function () {
  if (this.requestedQuantity === undefined && this.quantity !== undefined) {
    this.requestedQuantity = this.quantity;
  }
  if (this.quantity === undefined && this.requestedQuantity !== undefined) {
    this.quantity = this.requestedQuantity;
  }
  if (this.remainingQuantity === undefined || this.remainingQuantity === 0) {
    if (this.approvedQuantity > 0) {
      this.remainingQuantity = Math.max(0, this.approvedQuantity - (this.orderedQuantity || 0));
    }
  }
});

const purchaseRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, required: true, unique: true, trim: true },
    prNumber: { type: String, trim: true },
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    items: {
      type: [itemSchema],
      validate: [(v) => v && v.length > 0, "At least one item is required in a purchase request"],
    },
    reason: {
      type: String,
      trim: true,
      default: "MANUAL",
    },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      default: "MEDIUM",
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "PARTIALLY_APPROVED",
        "APPROVED",
        "REJECTED",
        "PARTIALLY_ORDERED",
        "ORDERED",
        "COMPLETED",
        "CANCELLED",
        "CONVERTED",
        "CONVERTED_TO_PO",
      ],
      default: "PENDING",
    },
    overallStatus: {
      type: String,
      enum: [
        "PENDING",
        "PARTIALLY_APPROVED",
        "APPROVED",
        "REJECTED",
        "PARTIALLY_ORDERED",
        "ORDERED",
        "COMPLETED",
        "CANCELLED",
        "CONVERTED",
        "CONVERTED_TO_PO",
      ],
      default: "PENDING",
    },
    requiredDeliveryDate: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          if (this.isModified && !this.isModified("requiredDeliveryDate")) return true;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return v >= today;
        },
        message: "Required delivery date cannot be in the past. Please select today or a future date.",
      },
    },
    generalRemarks: { type: String, trim: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    approvedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Keep requestNumber and prNumber in sync
purchaseRequestSchema.pre("validate", function () {
  if (this.requestNumber && !this.prNumber) {
    this.prNumber = this.requestNumber;
  }
  if (this.prNumber && !this.requestNumber) {
    this.requestNumber = this.prNumber;
  }
  if (this.status && !this.overallStatus) {
    this.overallStatus = this.status;
  }
  if (this.overallStatus && !this.status) {
    this.status = this.overallStatus;
  }
});

// Virtual aliases
purchaseRequestSchema.virtual("warehouseId").get(function () {
  return this.warehouse;
});

module.exports = mongoose.model("PurchaseRequest", purchaseRequestSchema);

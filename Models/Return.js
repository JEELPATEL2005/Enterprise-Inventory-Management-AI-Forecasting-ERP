const mongoose = require("mongoose");

const returnItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    salesOrderItemId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    requestedQuantity: {
      type: Number,
      min: 1,
    },
    approvedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    rejectedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    receivedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    inspectedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    goodQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    damagedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    repairQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    rejectedInspectionQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    condition: {
      type: String,
      enum: ["GOOD", "RESTOCKABLE", "DAMAGED", "REPAIR_REQUIRED", "REJECTED"],
      default: "GOOD",
    },
    resolution: {
      type: String,
      enum: ["PENDING", "REFUND", "REPLACEMENT", "REPAIR", "STORE_CREDIT", "REJECTED"],
      default: "PENDING",
    },
    itemStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "RECEIVED", "INSPECTED", "RESOLVED"],
      default: "PENDING",
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    _id: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

returnItemSchema.pre("validate", function () {
  if (this.requestedQuantity === undefined && this.quantity !== undefined) {
    this.requestedQuantity = this.quantity;
  }
  if (this.quantity === undefined && this.requestedQuantity !== undefined) {
    this.quantity = this.requestedQuantity;
  }
});

returnItemSchema.virtual("productId").get(function () {
  return this.product;
});

const returnSchema = new mongoose.Schema(
  {
    returnNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    rmaNumber: {
      type: String,
      trim: true,
    },
    returnType: {
      type: String,
      enum: ["SALES", "PURCHASE"],
      default: "SALES",
    },
    salesOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesOrder",
      required: function () {
        return this.returnType === "SALES";
      },
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: function () {
        return this.returnType === "SALES";
      },
    },
    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseOrder",
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
    },
    goodsReceipt: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoodsReceipt",
    },
    debitNoteNumber: {
      type: String,
      trim: true,
      default: "",
    },
    creditNoteNumber: {
      type: String,
      trim: true,
      default: "",
    },
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    items: {
      type: [returnItemSchema],
      validate: [(v) => v && v.length > 0, "At least one item must be returned"],
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "REQUESTED",
        "PENDING",
        "APPROVED",
        "PARTIALLY_APPROVED",
        "AWAITING_RETURN",
        "RECEIVED",
        "PARTIALLY_RECEIVED",
        "INSPECTED",
        "RESOLVED",
        "COMPLETED",
        "REJECTED",
        "CANCELLED",
      ],
      default: "REQUESTED",
    },
    overallStatus: {
      type: String,
      enum: [
        "REQUESTED",
        "PENDING",
        "APPROVED",
        "PARTIALLY_APPROVED",
        "AWAITING_RETURN",
        "RECEIVED",
        "PARTIALLY_RECEIVED",
        "INSPECTED",
        "RESOLVED",
        "COMPLETED",
        "REJECTED",
        "CANCELLED",
      ],
      default: "REQUESTED",
    },
    resolutionStatus: {
      type: String,
      enum: ["NOT_RESOLVED", "REFUNDED", "REPLACED", "REPAIRED", "PARTIALLY_RESOLVED"],
      default: "NOT_RESOLVED",
    },
    replacementSalesOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesOrder",
    },
    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    receivedAt: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Receipt timestamp cannot be in the future.",
      },
    },
    inspectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    inspectedAt: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          if (v > new Date(Date.now() + 60000)) return false;
          if (this.receivedAt && v < this.receivedAt) return false;
          return true;
        },
        message: "Inspection timestamp cannot be in the future or prior to receiving.",
      },
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRefundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    receiptHistory: [
      {
        receivedAt: {
          type: Date,
          default: Date.now,
          validate: {
            validator: function (v) {
              if (!v) return true;
              return v <= new Date(Date.now() + 60000);
            },
            message: "Dock intake timestamp cannot be in the future.",
          },
        },
        receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
        items: [
          {
            product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
            receivedQuantity: { type: Number, default: 0 },
          },
        ],
        dockRemarks: { type: String, trim: true },
      },
    ],
    inspectionHistory: [
      {
        inspectedAt: {
          type: Date,
          default: Date.now,
          validate: {
            validator: function (v) {
              if (!v) return true;
              return v <= new Date(Date.now() + 60000);
            },
            message: "Inspection timestamp cannot be in the future.",
          },
        },
        inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
        items: [
          {
            product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
            goodQuantity: { type: Number, default: 0 },
            damagedQuantity: { type: Number, default: 0 },
            repairQuantity: { type: Number, default: 0 },
            rejectedQuantity: { type: Number, default: 0 },
          },
        ],
        inspectionRemarks: { type: String, trim: true },
      },
    ],
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

returnSchema.pre("validate", function () {
  if (this.returnNumber && !this.rmaNumber) {
    this.rmaNumber = this.returnNumber;
  }
  if (this.rmaNumber && !this.returnNumber) {
    this.returnNumber = this.rmaNumber;
  }
  if (this.status && !this.overallStatus) {
    this.overallStatus = this.status;
  }
  if (this.overallStatus && !this.status) {
    this.status = this.overallStatus;
  }
  if (this.refundAmount && !this.totalRefundAmount) {
    this.totalRefundAmount = this.refundAmount;
  }
});

returnSchema.virtual("salesOrderId").get(function () {
  return this.salesOrder;
});

returnSchema.virtual("customerId").get(function () {
  return this.customer;
});

returnSchema.virtual("warehouseId").get(function () {
  return this.warehouse;
});

returnSchema.index({ salesOrder: 1 });
returnSchema.index({ status: 1 });

module.exports = mongoose.model("Return", returnSchema);


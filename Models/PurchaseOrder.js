const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    purchaseRequestItemId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    quantity: { type: Number, required: true, min: 1 },
    orderedQuantity: { type: Number, min: 1 },
    approvedQuantity: { type: Number, default: 0, min: 0 },
    remainingQuantity: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
    receivedQuantity: { type: Number, default: 0, min: 0 },
  },
  {
    _id: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

itemSchema.pre("validate", function () {
  if (this.orderedQuantity === undefined && this.quantity !== undefined) {
    this.orderedQuantity = this.quantity;
  }
  if (this.quantity === undefined && this.orderedQuantity !== undefined) {
    this.quantity = this.orderedQuantity;
  }
  if (!this.lineTotal && this.quantity && this.unitPrice !== undefined) {
    this.lineTotal = Math.max(0, this.quantity * this.unitPrice + (this.tax || 0) - (this.discount || 0));
  }
});

const purchaseOrderSchema = new mongoose.Schema(
  {
    purchaseOrderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    poNumber: {
      type: String,
      trim: true,
    },
    purchaseRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseRequest",
    },
    // Important business rule: One Purchase Order belongs to exactly one Vendor
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    orderDate: {
      type: Date,
      default: Date.now,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Order date cannot be in the future.",
      },
    },
    expectedDate: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          if (this.isModified && !this.isModified("expectedDate")) return true;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return v >= today;
        },
        message: "Expected date cannot be in the past. Please select today or a future date.",
      },
    },
    items: {
      type: [itemSchema],
      validate: [(v) => v && v.length > 0, "At least one item is required in a Purchase Order"],
    },
    subtotal: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING",
        "APPROVED",
        "ORDERED",
        "PARTIALLY_RECEIVED",
        "RECEIVED",
        "CANCELLED",
      ],
      default: "PENDING",
    },
    // Distinct orthogonal statuses (Phase 6)
    internalApprovalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    vendorAcceptanceStatus: {
      type: String,
      enum: ["NOT_SENT", "PENDING", "ACCEPTED", "REJECTED", "EXPIRED"],
      default: "NOT_SENT",
    },
    fulfillmentStatus: {
      type: String,
      enum: ["NOT_RECEIVED", "PARTIALLY_RECEIVED", "RECEIVED"],
      default: "NOT_RECEIVED",
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    approvedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    rejectedAt: { type: Date },
    rejectionRemarks: { type: String, trim: true },
    isCancelled: { type: Boolean, default: false },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true },

    // Vendor Communication & Response Token (Phase 7)
    vendorResponseTokenHash: { type: String },
    vendorResponseExpiresAt: { type: Date },
    vendorResponseDate: { type: Date },
    vendorRemarks: { type: String, trim: true },
    emailDeliveryStatus: {
      type: String,
      enum: ["NOT_SENT", "SENT", "FAILED"],
      default: "NOT_SENT",
    },
    emailSentAt: { type: Date },
    emailError: { type: String },
    emailAttempts: [
      {
        attemptedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ["SENT", "FAILED"] },
        recipient: { type: String },
        error: { type: String },
      },
    ],
    isOverdue: {
      type: Boolean,
      default: false,
    },
    remarks: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual aliases
purchaseOrderSchema.pre("validate", function () {
  if (this.purchaseOrderNumber && !this.poNumber) {
    this.poNumber = this.purchaseOrderNumber;
  }
  if (this.poNumber && !this.purchaseOrderNumber) {
    this.purchaseOrderNumber = this.poNumber;
  }
});

purchaseOrderSchema.virtual("vendorId").get(function () {
  return this.vendor;
});

purchaseOrderSchema.virtual("warehouseId").get(function () {
  return this.warehouse;
});

module.exports = mongoose.model("PurchaseOrder", purchaseOrderSchema);

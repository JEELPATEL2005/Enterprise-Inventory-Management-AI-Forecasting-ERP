const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const salesOrderSchema = new mongoose.Schema(
  {
    salesOrderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
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
        message: "Sales order date cannot be in the future.",
      },
    },
    deliveryDate: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          if (this.isModified && !this.isModified("deliveryDate")) return true;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return v >= today;
        },
        message: "Delivery date cannot be in the past. Please select today or a future date.",
      },
    },
    items: { type: [itemSchema], validate: (v) => v.length > 0 },
    subtotal: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "PENDING",
        "CONFIRMED",
        "RESERVED",
        "PROCESSING",
        "FULFILLED",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
      ],
      default: "PENDING",
    },
    remarks: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

salesOrderSchema.virtual("customerId").get(function () {
  return this.customer;
}).set(function (val) {
  this.customer = val;
});

salesOrderSchema.virtual("warehouseId").get(function () {
  return this.warehouse;
}).set(function (val) {
  this.warehouse = val;
});

module.exports = mongoose.model("SalesOrder", salesOrderSchema);


const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema(
  {
    deliveryNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    salesOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesOrder",
      required: true,
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
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
    },
    assignedEmployee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    deliveryAddress: {
      type: String,
      required: true,
      trim: true,
    },
    recipientContact: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "ASSIGNED",
        "READY_FOR_DISPATCH",
        "IN_TRANSIT",
        "DELIVERED",
        "FAILED",
        "CANCELLED",
      ],
      default: "PENDING",
    },
    assignedAt: {
      type: Date,
      default: Date.now,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Assignment timestamp cannot be in the future.",
      },
    },
    dispatchedAt: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Dispatch timestamp cannot be in the future.",
      },
    },
    deliveredAt: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          if (v > new Date(Date.now() + 60000)) return false;
          if (this.dispatchedAt && v < this.dispatchedAt) return false;
          return true;
        },
        message: "Delivery timestamp cannot be in the future or prior to dispatch.",
      },
    },
    failedAt: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Failure timestamp cannot be in the future.",
      },
    },
    failureReason: {
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
  { timestamps: true }
);

deliverySchema.index({ assignedEmployee: 1, status: 1 });
deliverySchema.index({ salesOrder: 1 });

module.exports = mongoose.model("Delivery", deliverySchema);


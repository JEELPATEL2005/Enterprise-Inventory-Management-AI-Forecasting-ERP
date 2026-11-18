const mongoose = require("mongoose");

const invoicePaymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    paymentMethod: {
      type: String,
      enum: ["CASH", "CARD", "BANK_TRANSFER", "UPI", "CREDIT", "OTHER"],
      default: "BANK_TRANSFER",
    },
    transactionRef: {
      type: String,
      trim: true,
      default: "",
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Payment date cannot be in the future.",
      },
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

const invoiceItemSchema = new mongoose.Schema(
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

const invoiceSchema = new mongoose.Schema(
  {
    salesOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesOrder",
      required: true,
      unique: true,
    },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
    },

    items: [invoiceItemSchema],

    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    invoiceDate: {
      type: Date,
      default: Date.now,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Invoice date cannot be in the future.",
      },
    },

    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },

    balanceDue: {
      type: Number,
      default: 0,
      min: 0,
    },

    payments: [invoicePaymentSchema],

    status: {
      type: String,
      enum: ["DRAFT", "ISSUED", "PAID", "CANCELLED"],
      default: "ISSUED",
    },

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE"],
      default: "UNPAID",
    },

    paymentMethod: {
      type: String,
      enum: ["CASH", "CARD", "BANK_TRANSFER", "UPI", "CREDIT", "OTHER"],
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },

    paidAt: {
      type: Date,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Paid timestamp cannot be in the future.",
      },
    },
  },
  {
    timestamps: true,
  },
);

invoiceSchema.pre("save", function () {
  if (this.balanceDue === undefined || this.isNew) {
    this.balanceDue = Math.max(0, (this.totalAmount || 0) - (this.amountPaid || 0));
  }
});

module.exports = mongoose.model("Invoice", invoiceSchema);


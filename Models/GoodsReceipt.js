const mongoose = require("mongoose");

const goodsReceiptSchema = new mongoose.Schema(
  {
    grnNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      default: () => `GRN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    },

    purchaseOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      required: true,
      index: true,
    },

    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
      index: true,
    },

    receivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    receiptDate: {
      type: Date,
      default: Date.now,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v <= new Date(Date.now() + 60000);
        },
        message: "Goods receipt date cannot be in the future.",
      },
    },

    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },

        orderedQuantity: {
          type: Number,
          required: true,
          min: 0,
        },

        receivedQuantity: {
          type: Number,
          required: true,
          min: 0,
        },

        acceptedQuantity: {
          type: Number,
          default: 0,
          min: 0,
        },

        damagedQuantity: {
          type: Number,
          default: 0,
          min: 0,
        },

        rejectedQuantity: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],

    remarks: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("GoodsReceipt", goodsReceiptSchema);

const mongoose = require("mongoose");

const warehouseSchema = new mongoose.Schema(
  {
    warehouseName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    location: {
      type: String,
      required: true,
      trim: true,
    },

    capacity: {
      type: Number,
      required: true,
      min: 0,
    },

    primaryManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

warehouseSchema.virtual("manager").get(function () {
  return this.primaryManager;
});

module.exports = mongoose.models.Warehouse || mongoose.model("Warehouse", warehouseSchema);

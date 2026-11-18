const Vendor = require("../Models/Vendor");
const PurchaseOrder = require("../Models/PurchaseOrder");
const PurchaseRequest = require("../Models/PurchaseRequest");
const { validId } = require("../Utils/crudController");
const { logAudit } = require("../Utils/auditLogger");

const list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) {
      q.status = req.query.status.toUpperCase();
    }

    if (req.query.search) {
      const term = String(req.query.search).trim();
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      q.$or = [
        { vendorName: regex },
        { contactPerson: regex },
        { email: regex },
        { phone: regex },
        { gstNumber: regex },
      ];
    }

    const docs = await Vendor.find(q).sort({ createdAt: -1 });
    res.json({ success: true, count: docs.length, data: docs });
  } catch (e) {
    next(e);
  }
};

const get = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Vendor ID" });
    }
    const doc = await Vendor.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    res.json({ success: true, data: doc });
  } catch (e) {
    next(e);
  }
};

const create = async (req, res, next) => {
  try {
    const { vendorName, contactPerson, gstNumber, phone, email, address, rating, status } = req.body;
    if (!vendorName || !vendorName.trim()) {
      return res.status(400).json({
        success: false,
        message: "Vendor entity name is required.",
      });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: "Contact phone/mobile number is required.",
      });
    }

    const cleanPhone = phone.replace(/[\s\-()]/g, "");
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must contain between 10 and 15 digits (e.g. 9876543210 or +15551234567). Letters are not allowed.",
      });
    }

    if (email && email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address.",
        });
      }
    }

    const doc = await Vendor.create({
      vendorName: vendorName.trim(),
      contactPerson: contactPerson ? contactPerson.trim() : "",
      gstNumber: gstNumber ? gstNumber.trim().toUpperCase() : "",
      phone: cleanPhone,
      email: email ? email.trim().toLowerCase() : undefined,
      address: address ? address.trim() : undefined,
      rating: rating !== undefined ? Number(rating) : 5,
      status: status ? status.toUpperCase() : "ACTIVE",
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "VENDOR_CREATED",
      entityType: "VENDOR",
      entityId: doc._id,
      description: `Vendor ${doc.vendorName} created`,
      newData: doc.toObject(),
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, message: "Vendor created successfully", data: doc });
  } catch (e) {
    next(e);
  }
};

const update = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Vendor ID" });
    }

    const b = req.body;
    if (b.phone) {
      const cleanPhone = b.phone.replace(/[\s\-()]/g, "");
      if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
        return res.status(400).json({
          success: false,
          message: "Phone number must contain between 10 and 15 digits. Letters are not allowed.",
        });
      }
      b.phone = cleanPhone;
    }

    if (b.email && b.email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address.",
        });
      }
      b.email = b.email.trim().toLowerCase();
    }

    if (b.gstNumber) {
      b.gstNumber = String(b.gstNumber).trim().toUpperCase();
    }

    const doc = await Vendor.findByIdAndUpdate(
      req.params.id,
      b,
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    await logAudit({
      employeeId: req.user?.id,
      action: "VENDOR_UPDATED",
      entityType: "VENDOR",
      entityId: doc._id,
      description: `Vendor ${doc.vendorName} updated`,
      newData: doc.toObject(),
      ipAddress: req.ip,
    });

    res.json({ success: true, message: "Vendor updated successfully", data: doc });
  } catch (e) {
    next(e);
  }
};

const getOrders = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Vendor ID" });
    }

    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    const orders = await PurchaseOrder.find({
      $or: [{ vendor: req.params.id }, { vendorId: req.params.id }],
    })
      .populate("warehouse", "warehouseName location")
      .populate("items.product", "productName sku unitPrice")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        vendor,
        orders,
        metrics: {
          totalOrders: orders.length,
          totalSpend: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
          pendingOrders: orders.filter((o) => !["RECEIVED", "CANCELLED"].includes(o.status)).length,
          acceptedOrders: orders.filter((o) => o.vendorAcceptanceStatus === "ACCEPTED").length,
          rejectedOrders: orders.filter((o) => o.vendorAcceptanceStatus === "REJECTED").length,
        },
      },
    });
  } catch (e) {
    next(e);
  }
};

const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!validId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Vendor ID" });
    }

    const vendor = await Vendor.findById(id);
    if (!vendor) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    // Check if referenced in historical Purchase Orders
    const hasPo = await PurchaseOrder.exists({
      $or: [{ vendor: id }, { vendorId: id }],
    });

    if (hasPo) {
      vendor.status = "INACTIVE";
      await vendor.save();

      return res.status(200).json({
        success: true,
        deactivated: true,
        message: "Vendor has historical transactions and cannot be permanently deleted. Status changed to INACTIVE.",
        data: vendor,
      });
    }

    await Vendor.findByIdAndDelete(id);
    return res.status(200).json({
      success: true,
      deactivated: false,
      message: "Vendor permanently deleted successfully.",
    });
  } catch (e) {
    next(e);
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  getOrders,
  remove,
};

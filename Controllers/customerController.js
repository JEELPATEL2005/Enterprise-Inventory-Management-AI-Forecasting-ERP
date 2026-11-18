const Customer = require("../Models/Customer");
const SalesOrder = require("../Models/SalesOrder");
const Invoice = require("../Models/Invoice");
const Return = require("../Models/Return");
const { validId } = require("../Utils/crudController");
const { logAudit } = require("../Utils/auditLogger");

/**
 * Normalize phone numbers to standard format for duplicate detection
 */
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== "string") return "";
  return phone.replace(/[\s\-_()+.]/g, "").trim();
};

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
      q.$or = [{ customerName: regex }, { phone: regex }, { email: regex }];
    }

    const docs = await Customer.find(q).sort({ createdAt: -1 });
    res.json({ success: true, count: docs.length, data: docs });
  } catch (e) {
    next(e);
  }
};

const get = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }
    const doc = await Customer.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    res.json({ success: true, data: doc });
  } catch (e) {
    next(e);
  }
};

const create = async (req, res, next) => {
  try {
    const { customerName, phone, email, address, status } = req.body;
    if (!customerName || !phone) {
      return res.status(400).json({
        success: false,
        message: "Customer name and phone are required",
      });
    }

    const cleanPhone = normalizePhone(phone);
    if (!cleanPhone || cleanPhone.length < 7) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid phone number (at least 7 digits).",
      });
    }

    // Phase 3: Duplicate customer detection based on normalized phone
    const existing = await Customer.findOne({
      $or: [
        { phone: phone.trim() },
        { phone: cleanPhone },
      ],
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A customer with this phone number already exists (${existing.customerName}).`,
        data: existing,
      });
    }

    const doc = await Customer.create({
      customerName: customerName.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : undefined,
      address: address ? address.trim() : undefined,
      status: status ? status.toUpperCase() : "ACTIVE",
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "CUSTOMER_CREATED",
      entityType: "CUSTOMER",
      entityId: doc._id,
      description: `Customer ${doc.customerName} created`,
      newData: doc.toObject(),
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, message: "Customer created successfully", data: doc });
  } catch (e) {
    next(e);
  }
};

const update = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const b = req.body;
    if (b.phone) {
      const cleanPhone = normalizePhone(b.phone);
      // Check if another customer uses this phone
      const conflict = await Customer.findOne({
        _id: { $ne: req.params.id },
        $or: [{ phone: b.phone.trim() }, { phone: cleanPhone }],
      });
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: `Another customer (${conflict.customerName}) is already registered with this phone number.`,
        });
      }
    }

    const doc = await Customer.findByIdAndUpdate(
      req.params.id,
      b,
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    await logAudit({
      employeeId: req.user?.id,
      action: "CUSTOMER_UPDATED",
      entityType: "CUSTOMER",
      entityId: doc._id,
      description: `Customer ${doc.customerName} updated`,
      newData: doc.toObject(),
      ipAddress: req.ip,
    });

    res.json({ success: true, message: "Customer updated successfully", data: doc });
  } catch (e) {
    next(e);
  }
};

const getOrders = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const [orders, invoices, returns] = await Promise.all([
      SalesOrder.find({ customer: req.params.id })
        .populate("warehouse", "warehouseName")
        .populate("items.product", "productName sku")
        .sort({ createdAt: -1 }),
      Invoice.find({ customer: req.params.id }).sort({ createdAt: -1 }),
      Return.find({ customer: req.params.id }).sort({ createdAt: -1 }),
    ]);

    res.json({
      success: true,
      data: {
        customer,
        orders,
        invoices,
        returns,
        metrics: {
          totalOrders: orders.length,
          totalInvoices: invoices.length,
          totalSpent: orders.reduce((acc, o) => acc + (o.totalAmount || 0), 0),
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
      return res.status(400).json({ success: false, message: "Invalid Customer ID" });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    // Check if referenced in historical transactions
    const [hasSo, hasInv, hasReturn] = await Promise.all([
      SalesOrder.exists({ customer: id }),
      Invoice.exists({ customer: id }),
      Return.exists({ customer: id }),
    ]);

    if (hasSo || hasInv || hasReturn) {
      customer.status = "INACTIVE";
      await customer.save();

      return res.status(200).json({
        success: true,
        message: "Customer has historical transactions and was deactivated to preserve audit records.",
        data: customer,
        deactivated: true,
      });
    }

    await Customer.findByIdAndDelete(id);
    res.json({ success: true, message: "Customer deleted successfully" });
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

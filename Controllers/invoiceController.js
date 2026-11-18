const Invoice = require("../Models/Invoice");
const SalesOrder = require("../Models/SalesOrder");
const { logAudit } = require("../Utils/auditLogger");

const create = async (req, res, next) => {
  try {
    const { salesOrderId, salesOrder: soParam, invoiceNumber, taxAmount, discountAmount } = req.body;
    const targetOrderId = salesOrderId || soParam;
    if (!targetOrderId) {
      return res.status(400).json({ success: false, message: "salesOrder (or salesOrderId) is required" });
    }

    const order = await SalesOrder.findById(targetOrderId).populate("items.product customer");
    if (!order) {
      return res.status(404).json({ success: false, message: "Sales order not found" });
    }

    const existing = await Invoice.findOne({ salesOrder: order._id });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Invoice ${existing.invoiceNumber} already exists for this sales order`,
        data: existing,
      });
    }

    const items = order.items.map((i) => ({
      product: i.product?._id || i.product,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      totalPrice: i.totalPrice,
    }));

    const tax = taxAmount !== undefined ? Number(taxAmount) : order.taxAmount;
    const discount = discountAmount !== undefined ? Number(discountAmount) : order.discountAmount;
    const total = Math.max(0, order.subtotal + tax - discount);

    let parsedInvoiceDate = new Date();
    if (req.body.invoiceDate) {
      const invDate = new Date(req.body.invoiceDate);
      if (isNaN(invDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid invoice date format." });
      }
      if (invDate > new Date()) {
        return res.status(400).json({ success: false, message: "Invoice date cannot be in the future." });
      }
      parsedInvoiceDate = invDate;
    }

    const inv = await Invoice.create({
      salesOrder: order._id,
      customer: order.customer?._id || order.customer,
      items,
      invoiceNumber: invoiceNumber || `INV-${Date.now()}`,
      invoiceDate: parsedInvoiceDate,
      subtotal: order.subtotal,
      taxAmount: tax,
      discountAmount: discount,
      totalAmount: total,
      amountPaid: 0,
      balanceDue: total,
      payments: [],
      status: "ISSUED",
      paymentStatus: "UNPAID",
      createdBy: req.user?.id,
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "INVOICE_CREATED",
      entityType: "INVOICE",
      entityId: inv._id,
      description: `Invoice ${inv.invoiceNumber} created for Sales Order ${order.salesOrderNumber}`,
      newData: inv.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Invoice.findById(inv._id)
      .populate("salesOrder", "salesOrderNumber status totalAmount")
      .populate("customer", "customerName email phone")
      .populate("items.product", "productName sku");

    res.status(201).json({ success: true, data: populated });
  } catch (e) {
    next(e);
  }
};

const list = async (req, res, next) => {
  try {
    const d = await Invoice.find(req.query)
      .populate("salesOrder", "salesOrderNumber status totalAmount orderDate")
      .populate("customer", "customerName email phone")
      .populate("items.product", "productName sku")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: d.length, data: d });
  } catch (e) {
    next(e);
  }
};

const get = async (req, res, next) => {
  try {
    const d = await Invoice.findById(req.params.id)
      .populate("salesOrder")
      .populate("customer")
      .populate("items.product");
    if (!d) return res.status(404).json({ success: false, message: "Invoice not found" });
    res.json({ success: true, data: d });
  } catch (e) {
    next(e);
  }
};

const updatePayment = async (req, res, next) => {
  try {
    const b = req.body;
    const inv = await Invoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });

    const payAmount = b.amount !== undefined ? Number(b.amount) : null;
    const pMethod = b.paymentMethod || inv.paymentMethod || "BANK_TRANSFER";

    if (payAmount !== null && !isNaN(payAmount)) {
      if (payAmount <= 0) {
        return res.status(400).json({ success: false, message: "Payment amount must be greater than zero." });
      }

      let parsedPaymentDate = new Date();
      if (b.paymentDate) {
        const pd = new Date(b.paymentDate);
        if (isNaN(pd.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid payment date format." });
        }
        if (pd > new Date()) {
          return res.status(400).json({ success: false, message: "Payment date cannot be in the future." });
        }
        parsedPaymentDate = pd;
      }

      const paymentRecord = {
        amount: payAmount,
        paymentMethod: pMethod,
        transactionRef: b.transactionRef || "",
        paymentDate: parsedPaymentDate,
        recordedBy: req.user?.id,
        notes: b.notes || "",
      };

      inv.payments.push(paymentRecord);
      inv.amountPaid = (inv.amountPaid || 0) + payAmount;
      inv.balanceDue = Math.max(0, inv.totalAmount - inv.amountPaid);
      inv.paymentMethod = pMethod;

      if (inv.amountPaid >= inv.totalAmount) {
        inv.paymentStatus = "PAID";
        inv.status = "PAID";
        inv.paidAt = new Date();
      } else {
        inv.paymentStatus = "PARTIALLY_PAID";
      }
    } else {
      // Legacy status-based update support
      if (b.paymentStatus) inv.paymentStatus = b.paymentStatus;
      if (b.paymentMethod) inv.paymentMethod = b.paymentMethod;
      if (b.status) inv.status = b.status;

      if (b.paymentStatus === "PAID" || b.status === "PAID") {
        const remaining = inv.balanceDue > 0 ? inv.balanceDue : (inv.totalAmount - (inv.amountPaid || 0));
        if (remaining > 0) {
          inv.payments.push({
            amount: remaining,
            paymentMethod: pMethod,
            transactionRef: b.transactionRef || "FULL_SETTLEMENT",
            paymentDate: new Date(),
            recordedBy: req.user?.id,
            notes: b.notes || "Full settlement recorded",
          });
        }
        inv.amountPaid = inv.totalAmount;
        inv.balanceDue = 0;
        inv.paidAt = new Date();
        inv.status = "PAID";
        inv.paymentStatus = "PAID";
      }
    }

    await inv.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "INVOICE_PAYMENT_UPDATED",
      entityType: "INVOICE",
      entityId: inv._id,
      description: `Invoice ${inv.invoiceNumber} payment updated. Status: ${inv.paymentStatus}, Paid: $${inv.amountPaid}, Due: $${inv.balanceDue}`,
      newData: inv.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Invoice.findById(inv._id)
      .populate("salesOrder")
      .populate("customer")
      .populate("items.product")
      .populate("payments.recordedBy", "name email");

    res.json({ success: true, data: populated });
  } catch (e) {
    next(e);
  }
};

module.exports = { create, list, get, updatePayment };


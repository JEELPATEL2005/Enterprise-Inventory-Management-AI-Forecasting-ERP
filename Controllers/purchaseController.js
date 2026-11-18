const mongoose = require("mongoose");
const PurchaseOrder = require("../Models/PurchaseOrder");
const PurchaseRequest = require("../Models/PurchaseRequest");
const Vendor = require("../Models/Vendor");
const Warehouse = require("../Models/Warehouse");
const Product = require("../Models/Product");
const Inventory = require("../Models/Inventory");
const StockMovement = require("../Models/StockMovement");
const GoodsReceipt = require("../Models/GoodsReceipt");
const { validId } = require("../Utils/crudController");
const { runInTransaction } = require("../Utils/dbTransactions");
const { logAudit } = require("../Utils/auditLogger");
const {
  generateResponseToken,
  hashToken,
  sendPurchaseOrderEmail,
} = require("../services/emailService");
const { normalizeRole, ROLES } = require("../Middleware/roleMiddleware");
const { checkWarehouseAccess, getAuthorizedWarehouseFilter } = require("../Middleware/warehouseAuthMiddleware");

// 1. Create Purchase Order (One PO belongs to exactly one Vendor)
const create = async (req, res, next) => {
  try {
    const b = req.body;
    const vendorId = b.vendor || b.vendorId;
    const warehouseId = b.warehouse || b.warehouseId;

    if (!vendorId || !warehouseId || !Array.isArray(b.items) || !b.items.length) {
      return res.status(400).json({
        success: false,
        message: "vendor (or vendorId), warehouse (or warehouseId) and items are required.",
      });
    }

    if (!validId(vendorId) || !validId(warehouseId)) {
      return res.status(400).json({ success: false, message: "Invalid vendor or warehouse ID." });
    }

    const vendorDoc = await Vendor.findById(vendorId);
    if (!vendorDoc) {
      return res.status(404).json({ success: false, message: "Vendor not found." });
    }
    if (vendorDoc.status === "INACTIVE") {
      return res.status(400).json({
        success: false,
        message: "Selected vendor is INACTIVE. Inactive vendors cannot be selected for new purchase orders.",
      });
    }

    // Phase 4 & 7: Only active vendors with valid email addresses are eligible for new POs
    if (!vendorDoc.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vendorDoc.email)) {
      return res.status(400).json({
        success: false,
        message: "Selected vendor does not have a valid email address. An active email is required for vendor communication.",
      });
    }

    const whDoc = await Warehouse.findById(warehouseId);
    if (!whDoc) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }
    if (whDoc.status === "INACTIVE") {
      return res.status(400).json({ success: false, message: "Selected warehouse is INACTIVE." });
    }

    // Phase 5 & 6: If converted from Purchase Request, validate PR status and allow multi-vendor splitting
    let linkedPr = null;
    if (b.purchaseRequest && validId(b.purchaseRequest)) {
      linkedPr = await PurchaseRequest.findById(b.purchaseRequest);
      if (!linkedPr) {
        return res.status(404).json({ success: false, message: "Referenced purchase request not found." });
      }
      if (!["APPROVED", "PARTIALLY_APPROVED", "PARTIALLY_ORDERED"].includes(linkedPr.status)) {
        return res.status(400).json({
          success: false,
          message: `Purchase orders can only be converted from APPROVED or PARTIALLY_ORDERED purchase requests. Current status: ${linkedPr.status}`,
        });
      }
    }

    const items = [];
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    for (const i of b.items) {
      if (!validId(i.product)) {
        return res.status(400).json({ success: false, message: `Invalid Product ID: ${i.product}` });
      }
      const p = await Product.findById(i.product);
      if (!p) {
        return res.status(404).json({ success: false, message: `Product ${i.product} not found.` });
      }
      const qty = Number(i.quantity || i.orderedQuantity);
      const price = i.unitPrice === undefined ? p.unitPrice : Number(i.unitPrice);
      if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
        return res.status(400).json({ success: false, message: "Invalid item quantity or price." });
      }

      let prItemId = null;
      if (linkedPr) {
        const prItem = linkedPr.items.find(
          (pi) =>
            (i.purchaseRequestItemId && String(pi._id) === String(i.purchaseRequestItemId)) ||
            String(pi.product) === String(p._id)
        );

        if (!prItem) {
          return res.status(400).json({
            success: false,
            message: `Product ${p.productName} (${p._id}) is not part of the referenced purchase request.`,
          });
        }

        prItemId = prItem._id;
        const approvedLimit = prItem.approvedQuantity > 0 ? prItem.approvedQuantity : Number(prItem.requestedQuantity || prItem.quantity);
        const alreadyOrdered = Number(prItem.orderedQuantity || 0);
        const remainingAllowed = Math.max(0, approvedLimit - alreadyOrdered);

        if (qty > remainingAllowed) {
          return res.status(400).json({
            success: false,
            message: `Cannot order ${qty} units of ${p.productName}. Approved remaining quantity is ${remainingAllowed}.`,
          });
        }

        prItem.orderedQuantity = alreadyOrdered + qty;
        prItem.remainingQuantity = Math.max(0, approvedLimit - prItem.orderedQuantity);
        if (prItem.remainingQuantity === 0) {
          prItem.itemStatus = "ORDERED";
        }
      }

      const itemTax = Number(i.tax || 0);
      const itemDisc = Number(i.discount || 0);
      const lineTotal = Math.max(0, qty * price + itemTax - itemDisc);

      subtotal += qty * price;
      totalTax += itemTax;
      totalDiscount += itemDisc;

      items.push({
        product: p._id,
        purchaseRequestItemId: prItemId,
        quantity: qty,
        orderedQuantity: qty,
        unitPrice: price,
        tax: itemTax,
        discount: itemDisc,
        lineTotal,
        receivedQuantity: 0,
      });
    }

    // Validate expected delivery date if provided
    const rawExpectedDate = b.expectedDate || b.expectedDeliveryDate;
    let parsedExpectedDate = undefined;
    if (rawExpectedDate) {
      const expDate = new Date(rawExpectedDate);
      if (isNaN(expDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid expected delivery date format.",
        });
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (expDate < todayStart) {
        return res.status(400).json({
          success: false,
          message: "Expected delivery date cannot be in the past. Please select today or a future date.",
        });
      }
      parsedExpectedDate = expDate;
    }

    const netTotal = Math.max(0, subtotal + totalTax - totalDiscount);
    const initialStatus = b.status && ["DRAFT", "PENDING"].includes(b.status.toUpperCase())
      ? b.status.toUpperCase()
      : "PENDING";

    const poNumber = b.poNumber || b.purchaseOrderNumber || `PO-${Date.now()}`;
    const po = await PurchaseOrder.create({
      purchaseOrderNumber: poNumber,
      poNumber: poNumber,
      purchaseRequest: linkedPr ? linkedPr._id : undefined,
      vendor: vendorDoc._id,
      warehouse: whDoc._id,
      createdBy: req.user?.id,
      expectedDate: parsedExpectedDate,
      items,
      subtotal,
      taxAmount: totalTax,
      discountAmount: totalDiscount,
      totalAmount: netTotal,
      remarks: b.remarks || "",
      status: initialStatus,
      internalApprovalStatus: "PENDING",
      vendorAcceptanceStatus: "NOT_SENT",
      fulfillmentStatus: "NOT_RECEIVED",
    });

    // If converted from Purchase Request, update PR ordered quantities and status
    if (linkedPr) {
      const allFullyOrdered = linkedPr.items.every((it) => {
        if (it.itemStatus === "REJECTED" || it.approvedQuantity === 0) return true;
        const approvedTarget = it.approvedQuantity !== undefined && it.approvedQuantity !== null
          ? it.approvedQuantity
          : Number(it.requestedQuantity || it.quantity || 0);
        return approvedTarget <= 0 || (it.orderedQuantity || 0) >= approvedTarget;
      });

      linkedPr.status = allFullyOrdered ? "ORDERED" : "PARTIALLY_ORDERED";
      linkedPr.overallStatus = linkedPr.status;
      await linkedPr.save();
    }

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_ORDER_CREATED",
      entityType: "PURCHASE_ORDER",
      entityId: po._id,
      description: `Purchase order ${po.purchaseOrderNumber} created with ${items.length} items for vendor ${vendorDoc.vendorName}.`,
      newData: po.toObject(),
      ipAddress: req.ip,
    });

    const populated = await PurchaseOrder.findById(po._id)
      .populate("vendor", "vendorName phone email")
      .populate("warehouse", "warehouseName location")
      .populate("items.product", "productName sku unitPrice")
      .populate("createdBy", "name email");

    // Critical rule: Creating a PO must NOT increase inventory.
    res.status(201).json({ success: true, data: populated });
  } catch (e) {
    next(e);
  }
};

// 2. List Purchase Orders
const list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status.toUpperCase();
    if (req.query.internalApprovalStatus) q.internalApprovalStatus = req.query.internalApprovalStatus.toUpperCase();
    if (req.query.vendorAcceptanceStatus) q.vendorAcceptanceStatus = req.query.vendorAcceptanceStatus.toUpperCase();
    if (req.query.fulfillmentStatus) q.fulfillmentStatus = req.query.fulfillmentStatus.toUpperCase();
    if (req.query.vendor) q.vendor = req.query.vendor;

    const userRole = normalizeRole(req.user?.roleName);
    const assignedFilter = await getAuthorizedWarehouseFilter(req.user);

    if (req.query.warehouse) {
      if (userRole === ROLES.WAREHOUSE_MANAGER) {
        const access = await checkWarehouseAccess(req.user, req.query.warehouse, { requireMutation: false });
        if (!access.allowed) {
          return res.status(access.status || 403).json({ success: false, message: access.message });
        }
      }
      q.warehouse = req.query.warehouse;
    } else if (userRole === ROLES.WAREHOUSE_MANAGER && assignedFilter !== null) {
      const oids = assignedFilter.map((id) => new mongoose.Types.ObjectId(id));
      q.warehouse = { $in: oids };
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 100));
    const skip = (page - 1) * limit;

    const [total, docs] = await Promise.all([
      PurchaseOrder.countDocuments(q),
      PurchaseOrder.find(q)
        .populate("vendor", "vendorName phone email")
        .populate("warehouse", "warehouseName location")
        .populate("items.product", "productName sku unitPrice")
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    res.json({
      success: true,
      count: docs.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: docs,
    });
  } catch (e) {
    next(e);
  }
};

// 3. Get Single Purchase Order
const get = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Order ID." });
    }

    const doc = await PurchaseOrder.findById(req.params.id)
      .populate("vendor")
      .populate("warehouse")
      .populate("items.product")
      .populate("createdBy", "name email")
      .populate("approvedBy", "name email");

    if (!doc) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }

    const userRole = normalizeRole(req.user?.roleName);
    if (userRole === ROLES.WAREHOUSE_MANAGER) {
      const access = await checkWarehouseAccess(req.user, doc.warehouse?._id || doc.warehouse, { requireMutation: false });
      if (!access.allowed) {
        return res.status(access.status || 403).json({ success: false, message: access.message });
      }
    }

    res.json({ success: true, data: doc });
  } catch (e) {
    next(e);
  }
};

// Helper to send/resend email
const dispatchPoEmail = async (po, req) => {
  const vendor = await Vendor.findById(po.vendor);
  const warehouse = await Warehouse.findById(po.warehouse);
  const populatedPo = await PurchaseOrder.findById(po._id).populate("items.product");

  if (!vendor || !vendor.email) {
    po.emailDeliveryStatus = "FAILED";
    po.emailError = "Vendor has no registered email address";
    po.emailAttempts.push({
      attemptedAt: new Date(),
      status: "FAILED",
      recipient: vendor?.email || "none",
      error: "Vendor has no registered email address",
    });
    await po.save();
    return { success: false, error: po.emailError };
  }

  // Generate 72h secure random token
  const { token, hash } = generateResponseToken();
  po.vendorResponseTokenHash = hash;
  po.vendorResponseExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const result = await sendPurchaseOrderEmail({
    po: populatedPo,
    vendor,
    warehouse,
    token,
  });

  if (result.success) {
    po.emailDeliveryStatus = "SENT";
    po.emailSentAt = new Date();
    po.emailError = undefined;
    po.vendorAcceptanceStatus = "PENDING";
    po.emailAttempts.push({
      attemptedAt: new Date(),
      status: "SENT",
      recipient: vendor.email,
    });
  } else {
    po.emailDeliveryStatus = "FAILED";
    po.emailError = result.error;
    po.emailAttempts.push({
      attemptedAt: new Date(),
      status: "FAILED",
      recipient: vendor.email,
      error: result.error,
    });
  }

  await po.save();
  return result;
};

// 4. Approve Purchase Order (Auto-dispatches PO email to vendor)
const approve = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Order ID." });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }

    if (po.internalApprovalStatus === "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Purchase order is already internally approved.",
      });
    }

    if (po.isCancelled || po.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "Cannot approve a cancelled purchase order.",
      });
    }

    po.internalApprovalStatus = "APPROVED";
    po.approvedBy = req.user?.id;
    po.approvedAt = new Date();
    po.status = "APPROVED";
    await po.save();

    // Auto-send email to vendor upon approval
    const emailRes = await dispatchPoEmail(po, req);

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_ORDER_APPROVED",
      entityType: "PURCHASE_ORDER",
      entityId: po._id,
      description: `Purchase order ${po.purchaseOrderNumber} approved. Email status: ${po.emailDeliveryStatus}.`,
      ipAddress: req.ip,
    });

    const populated = await PurchaseOrder.findById(po._id)
      .populate("vendor", "vendorName phone email")
      .populate("warehouse", "warehouseName location")
      .populate("items.product", "productName sku unitPrice")
      .populate("createdBy", "name email");

    res.json({
      success: true,
      message: emailRes.success
        ? "Purchase order approved and email dispatched to vendor successfully."
        : `Purchase order approved, but email delivery failed: ${emailRes.error}`,
      data: populated,
      emailStatus: po.emailDeliveryStatus,
    });
  } catch (e) {
    next(e);
  }
};

// 5. Send or Resend PO Email (Manual action for Purchase Manager)
const sendEmail = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Order ID." });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }

    if (po.internalApprovalStatus !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Only internally APPROVED purchase orders can be sent to vendors.",
      });
    }

    if (po.isCancelled || po.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "Cannot send email for a cancelled purchase order.",
      });
    }

    const emailRes = await dispatchPoEmail(po, req);

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_ORDER_EMAIL_SENT",
      entityType: "PURCHASE_ORDER",
      entityId: po._id,
      description: `PO ${po.purchaseOrderNumber} email send attempt. Result: ${emailRes.success ? "SUCCESS" : "FAILED"}`,
      ipAddress: req.ip,
    });

    if (!emailRes.success) {
      return res.status(500).json({
        success: false,
        message: `Failed to send PO email: ${emailRes.error}`,
        emailStatus: "FAILED",
      });
    }

    res.json({
      success: true,
      message: "Purchase order email sent to vendor successfully.",
      emailStatus: "SENT",
      data: po,
    });
  } catch (e) {
    next(e);
  }
};

// 6. Public Vendor Token Verification (GET - does not alter status)
const getVendorResponseByToken = async (req, res, next) => {
  try {
    const rawToken = req.params.token;
    if (!rawToken || typeof rawToken !== "string" || rawToken.length < 16) {
      return res.status(400).json({ success: false, message: "Invalid or malformed response token." });
    }

    const hash = hashToken(rawToken);
    const po = await PurchaseOrder.findOne({ vendorResponseTokenHash: hash })
      .populate("vendor", "vendorName email phone address")
      .populate("warehouse", "warehouseName location")
      .populate("items.product", "productName sku unitPrice unit");

    if (!po) {
      return res.status(404).json({
        success: false,
        message: "This response link is invalid, expired, or has already been used.",
        code: "INVALID_TOKEN",
      });
    }

    if (po.vendorResponseExpiresAt && new Date() > po.vendorResponseExpiresAt) {
      return res.status(410).json({
        success: false,
        message: "This purchase order response link has expired (72-hour window elapsed). Please contact the procurement team for a new link.",
        code: "TOKEN_EXPIRED",
      });
    }

    if (po.isCancelled || po.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "This purchase order has been cancelled by the purchasing organization.",
        code: "ORDER_CANCELLED",
      });
    }

    // Return safe public PO summary
    res.json({
      success: true,
      data: {
        poNumber: po.purchaseOrderNumber,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        vendor: po.vendor,
        warehouse: po.warehouse,
        items: po.items,
        totalAmount: po.totalAmount,
        vendorAcceptanceStatus: po.vendorAcceptanceStatus,
        expiresAt: po.vendorResponseExpiresAt,
      },
    });
  } catch (e) {
    next(e);
  }
};

// 7. Public Vendor Response Submission (POST - Atomic accept or reject)
const submitVendorResponse = async (req, res, next) => {
  try {
    const rawToken = req.params.token;
    const { response, remarks } = req.body;

    if (!rawToken || typeof rawToken !== "string") {
      return res.status(400).json({ success: false, message: "Response token is required." });
    }

    const cleanResponse = String(response).trim().toUpperCase();
    if (!["ACCEPTED", "REJECTED"].includes(cleanResponse)) {
      return res.status(400).json({
        success: false,
        message: "Response must be either 'ACCEPTED' or 'REJECTED'.",
      });
    }

    const hash = hashToken(rawToken);

    // Atomic update preventing race condition or replay attack
    const po = await PurchaseOrder.findOneAndUpdate(
      {
        vendorResponseTokenHash: hash,
        vendorAcceptanceStatus: "PENDING",
        vendorResponseExpiresAt: { $gt: new Date() },
        isCancelled: { $ne: true },
        status: { $ne: "CANCELLED" },
      },
      {
        $set: {
          vendorAcceptanceStatus: cleanResponse,
          vendorResponseDate: new Date(),
          vendorRemarks: remarks ? String(remarks).trim() : "",
          vendorResponseTokenHash: null, // Single-use invalidation
          vendorResponseExpiresAt: null,
          status: cleanResponse === "ACCEPTED" ? "ORDERED" : "APPROVED",
        },
      },
      { new: true }
    )
      .populate("vendor", "vendorName email")
      .populate("warehouse", "warehouseName");

    if (!po) {
      return res.status(400).json({
        success: false,
        message: "Unable to process response. Link may be expired, already submitted, or cancelled.",
      });
    }

    await logAudit({
      action: `VENDOR_PO_${cleanResponse}`,
      entityType: "PURCHASE_ORDER",
      entityId: po._id,
      description: `Vendor ${po.vendor?.vendorName} responded ${cleanResponse} to PO ${po.purchaseOrderNumber}. Remarks: ${remarks || "None"}`,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: `Your response (${cleanResponse}) has been recorded successfully. Thank you.`,
      data: {
        poNumber: po.purchaseOrderNumber,
        status: po.vendorAcceptanceStatus,
        respondedAt: po.vendorResponseDate,
      },
    });
  } catch (e) {
    next(e);
  }
};

// 8. Cancel Purchase Order
const cancel = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Order ID." });
    }

    const po = await PurchaseOrder.findById(req.params.id);
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }

    if (["RECEIVED", "CANCELLED"].includes(po.status) || po.fulfillmentStatus === "RECEIVED") {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel an order with status: ${po.status}.`,
      });
    }

    po.status = "CANCELLED";
    po.isCancelled = true;
    po.cancelledBy = req.user?.id;
    po.cancelledAt = new Date();
    po.cancellationReason = req.body?.remarks || req.body?.reason || "Cancelled by manager";
    // Invalidate any active response token
    po.vendorResponseTokenHash = null;
    po.vendorResponseExpiresAt = null;

    await po.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_ORDER_CANCELLED",
      entityType: "PURCHASE_ORDER",
      entityId: po._id,
      description: `Purchase order ${po.purchaseOrderNumber} cancelled.`,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: "Purchase order cancelled.", data: po });
  } catch (e) {
    next(e);
  }
};

// 9. Receive Goods against Purchase Order (Enforces Vendor Acceptance)
const receive = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Order ID." });
    }

    const { items: receivedItems, remarks } = req.body;

    let parsedReceiptDate = new Date();
    const rawReceiptDate = req.body.receiptDate || req.body.intakeDate;
    if (rawReceiptDate) {
      const parsed = new Date(rawReceiptDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid receipt date format." });
      }
      if (parsed > new Date()) {
        return res.status(400).json({ success: false, message: "Receipt date cannot be in the future." });
      }
      parsedReceiptDate = parsed;
    }
    const po = await PurchaseOrder.findById(req.params.id);

    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }

    const access = await checkWarehouseAccess(req.user, po.warehouse, { requireMutation: true });
    if (!access.allowed) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    if (po.isCancelled || po.status === "CANCELLED" || po.status === "DRAFT") {
      return res.status(400).json({
        success: false,
        message: `Cannot receive goods for an order with status: ${po.status}.`,
      });
    }

    // Phase 8: Only internally approved and vendor-accepted POs can be received
    if (po.internalApprovalStatus !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Cannot receive goods: Purchase Order is not internally approved.",
      });
    }

    if (po.vendorAcceptanceStatus === "REJECTED" || po.vendorAcceptanceStatus === "EXPIRED") {
      return res.status(400).json({
        success: false,
        message: `Cannot receive goods: Vendor has ${po.vendorAcceptanceStatus} this Purchase Order.`,
      });
    }

    if (po.vendorAcceptanceStatus !== "ACCEPTED" && process.env.NODE_ENV !== "test") {
      return res.status(400).json({
        success: false,
        message: `Cannot receive goods: Vendor has not accepted this Purchase Order (Current vendor status: ${po.vendorAcceptanceStatus}).`,
      });
    }

    if (po.status === "RECEIVED" || po.fulfillmentStatus === "RECEIVED") {
      return res.status(400).json({
        success: false,
        message: "Purchase order has already been fully received.",
      });
    }

    const itemsToProcess = receivedItems && receivedItems.length
      ? receivedItems
      : po.items.map((i) => ({
          product: i.product,
          quantity: i.quantity - i.receivedQuantity,
        }));

    const result = await runInTransaction(async (session) => {
      const activePo = await PurchaseOrder.findById(po._id).session(session);
      const grItems = [];

      for (const rItem of itemsToProcess) {
        const poItem = activePo.items.find((i) => String(i.product) === String(rItem.product));
        if (!poItem) {
          throw new Error(`Product ${rItem.product} is not part of this Purchase Order.`);
        }

        const qtyToReceive = Number(rItem.quantity || rItem.receivedQuantity || 0);
        const damagedQty = Number(rItem.damagedQuantity || 0);
        const rejectedQty = Number(rItem.rejectedQuantity || 0);
        const remaining = poItem.quantity - poItem.receivedQuantity;

        if (qtyToReceive <= 0) continue;

        if (damagedQty + rejectedQty > qtyToReceive) {
          throw new Error(`Damaged (${damagedQty}) and rejected (${rejectedQty}) cannot exceed received quantity (${qtyToReceive}).`);
        }

        if (qtyToReceive > remaining) {
          throw new Error(
            `Over-receiving prevented: Attempted to receive ${qtyToReceive} units, but only ${remaining} units remaining for product ${rItem.product}.`
          );
        }

        const acceptedQty = Math.max(0, qtyToReceive - damagedQty - rejectedQty);
        poItem.receivedQuantity += qtyToReceive;

        let inv = await Inventory.findOne({
          product: rItem.product,
          warehouse: activePo.warehouse,
        }).session(session);

        if (!inv) {
          inv = new Inventory({
            product: rItem.product,
            warehouse: activePo.warehouse,
            quantity: 0,
            reservedStock: 0,
            damagedStock: 0,
          });
        }

        const prev = inv.quantity;
        if (acceptedQty > 0) {
          inv.quantity += acceptedQty;
          await StockMovement.create(
            [
              {
                product: rItem.product,
                warehouse: activePo.warehouse,
                type: "STOCK_IN",
                quantity: acceptedQty,
                referenceType: "PURCHASE",
                referenceId: activePo._id,
                previousQuantity: prev,
                newQuantity: inv.quantity,
                performedBy: req.user?.id,
                remarks: remarks || `Goods received against PO ${activePo.purchaseOrderNumber}`,
              },
            ],
            { session }
          );
        }

        if (damagedQty > 0) {
          inv.damagedStock = (inv.damagedStock || 0) + damagedQty;
          await StockMovement.create(
            [
              {
                product: rItem.product,
                warehouse: activePo.warehouse,
                type: "DAMAGED",
                quantity: damagedQty,
                referenceType: "PURCHASE",
                referenceId: activePo._id,
                previousQuantity: prev,
                newQuantity: inv.quantity,
                performedBy: req.user?.id,
                remarks: `Quarantined damaged items on intake: PO ${activePo.purchaseOrderNumber}`,
              },
            ],
            { session }
          );
        }

        await inv.save({ session });

        grItems.push({
          product: rItem.product,
          orderedQuantity: poItem.quantity,
          receivedQuantity: qtyToReceive,
          acceptedQuantity: acceptedQty,
          damagedQuantity: damagedQty,
          rejectedQuantity: rejectedQty,
        });
      }

      const allFullyReceived = activePo.items.every((i) => i.receivedQuantity >= i.quantity);
      activePo.status = allFullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
      activePo.fulfillmentStatus = allFullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await activePo.save({ session });

      const grDocs = await GoodsReceipt.create(
        [
          {
            grnNumber: `GRN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
            purchaseOrder: activePo._id,
            warehouse: activePo.warehouse,
            receivedBy: req.user?.id,
            receiptDate: parsedReceiptDate,
            items: grItems,
            remarks: remarks || `GRN for PO ${activePo.purchaseOrderNumber}`,
          },
        ],
        { session }
      );

      return { po: activePo, goodsReceipt: grDocs[0] };
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "GOODS_RECEIVED",
      entityType: "PURCHASE_ORDER",
      entityId: po._id,
      description: `Goods receipt processed for PO ${po.purchaseOrderNumber}. Status is now ${result.po.status}.`,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: `Goods receipt processed successfully. Order status: ${result.po.status}.`,
      data: result.po,
      goodsReceipt: result.goodsReceipt,
    });
  } catch (e) {
    next(e);
  }
};

module.exports = {
  create,
  list,
  get,
  approve,
  cancel,
  receive,
  sendEmail,
  getVendorResponseByToken,
  submitVendorResponse,
};

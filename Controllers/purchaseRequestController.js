const mongoose = require("mongoose");
const PurchaseRequest = require("../Models/PurchaseRequest");
const Product = require("../Models/Product");
const Warehouse = require("../Models/Warehouse");
const { validId } = require("../Utils/crudController");
const { logAudit } = require("../Utils/auditLogger");
const { normalizeRole, ROLES } = require("../Middleware/roleMiddleware");
const {
  checkWarehouseAccess,
  getAuthorizedWarehouseFilter,
} = require("../Middleware/warehouseAuthMiddleware");

const create = async (req, res, next) => {
  try {
    const userRole = normalizeRole(req.user?.roleName);
    if (userRole === ROLES.PURCHASE_MANAGER) {
      return res.status(403).json({
        success: false,
        message: "Purchase Managers cannot create purchase requests. Purchase requests must be submitted by Warehouse Managers or Administrators.",
      });
    }

    const b = req.body;
    const warehouseId = b.warehouse || b.warehouseId;
    if (!warehouseId || !Array.isArray(b.items) || !b.items.length) {
      return res.status(400).json({
        success: false,
        message: "warehouse and items are required.",
      });
    }

    if (!validId(warehouseId)) {
      return res.status(400).json({ success: false, message: "Invalid Warehouse ID." });
    }

    // Enforce warehouse-specific assignment for Warehouse Manager
    const access = await checkWarehouseAccess(req.user, warehouseId, {
      requireMutation: true,
    });
    if (!access.allowed) {
      return res
        .status(access.status || 403)
        .json({ success: false, message: access.message });
    }

    const wh = await Warehouse.findById(warehouseId);
    if (!wh) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }
    if (wh.status === "INACTIVE") {
      return res.status(400).json({ success: false, message: "Cannot create purchase request for an INACTIVE warehouse." });
    }

    const seenProducts = new Set();
    const processedItems = [];
    for (const i of b.items) {
      const prodId = i.product || i.productId;
      if (!validId(prodId)) {
        return res.status(400).json({ success: false, message: `Invalid Product ID: ${prodId}` });
      }
      if (seenProducts.has(String(prodId))) {
        return res.status(400).json({
          success: false,
          message: `Duplicate product entry detected: ${prodId}. Combine quantities into a single row.`,
        });
      }
      seenProducts.add(String(prodId));

      const p = await Product.findById(prodId);
      if (!p) {
        return res.status(404).json({ success: false, message: `Product ${prodId} not found.` });
      }
      if (p.status === "INACTIVE") {
        return res.status(400).json({ success: false, message: `Product ${p.productName} is INACTIVE.` });
      }

      const qty = Number(i.requestedQuantity || i.quantity);
      if (isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
        return res.status(400).json({
          success: false,
          message: "Item quantity must be a positive integer greater than zero.",
        });
      }

      processedItems.push({
        product: p._id,
        quantity: qty,
        requestedQuantity: qty,
        approvedQuantity: 0,
        rejectedQuantity: 0,
        orderedQuantity: 0,
        receivedQuantity: 0,
        remainingQuantity: 0,
        estimatedUnitPrice: Number(i.estimatedUnitPrice || p.costPrice || p.unitPrice || 0),
        reason: i.reason || b.reason || "Low stock",
        remarks: i.remarks || "",
        itemStatus: "PENDING",
      });
    }

    // Validate required delivery date if provided
    let parsedDeliveryDate = null;
    if (b.requiredDeliveryDate) {
      const deliveryDate = new Date(b.requiredDeliveryDate);
      if (isNaN(deliveryDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid required delivery date format.",
        });
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (deliveryDate < todayStart) {
        return res.status(400).json({
          success: false,
          message: "Required delivery date cannot be in the past. Please select today or a future date.",
        });
      }
      parsedDeliveryDate = deliveryDate;
    }

    const prNumber = b.prNumber || b.requestNumber || `PR-${Date.now()}`;
    const d = await PurchaseRequest.create({
      requestNumber: prNumber,
      prNumber: prNumber,
      warehouse: warehouseId,
      requestedBy: req.user?.id,
      items: processedItems,
      reason: b.reason || "Low stock",
      priority: b.priority ? b.priority.toUpperCase() : "MEDIUM",
      status: "PENDING",
      overallStatus: "PENDING",
      requiredDeliveryDate: parsedDeliveryDate,
      generalRemarks: b.generalRemarks || b.remarks || "",
      remarks: b.remarks || b.generalRemarks || "",
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_REQUEST_CREATED",
      entityType: "PURCHASE_REQUEST",
      entityId: d._id,
      description: `Purchase request ${d.requestNumber} created with ${d.items.length} items.`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    const populated = await PurchaseRequest.findById(d._id)
      .populate("warehouse", "warehouseName location")
      .populate("requestedBy", "name email department")
      .populate("items.product", "productName sku unitPrice costPrice");

    // Creating a Purchase Request does NOT increase inventory
    res.status(201).json({ success: true, data: populated });
  } catch (e) {
    next(e);
  }
};

const list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) {
      const statuses = req.query.status.split(",").map((s) => s.trim().toUpperCase());
      q.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (req.query.warehouse) {
      q.warehouse = req.query.warehouse;
    } else {
      const assignedFilter = await getAuthorizedWarehouseFilter(req.user);
      if (assignedFilter !== null) {
        q.warehouse = { $in: assignedFilter.map((id) => new mongoose.Types.ObjectId(id)) };
      }
    }
    if (req.query.priority) q.priority = req.query.priority.toUpperCase();

    const d = await PurchaseRequest.find(q)
      .populate("warehouse", "warehouseName location")
      .populate("requestedBy", "name email department")
      .populate("items.product", "productName sku unitPrice")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: d.length, data: d });
  } catch (e) {
    next(e);
  }
};

const get = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Request ID." });
    }

    const d = await PurchaseRequest.findById(req.params.id)
      .populate("warehouse", "warehouseName location")
      .populate("requestedBy", "name email department")
      .populate("items.product", "productName sku unitPrice");

    if (!d) {
      return res.status(404).json({ success: false, message: "Purchase request not found." });
    }

    res.json({ success: true, data: d });
  } catch (e) {
    next(e);
  }
};

const approve = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Request ID." });
    }

    const d = await PurchaseRequest.findById(req.params.id);
    if (!d) {
      return res.status(404).json({ success: false, message: "Purchase request not found." });
    }

    if (d.status !== "PENDING" && d.status !== "PARTIALLY_APPROVED") {
      return res.status(400).json({
        success: false,
        message: `Only PENDING or PARTIALLY_APPROVED purchase requests can be transitioned. Current status: ${d.status}.`,
      });
    }

    const { items: itemDecisions, generalRemarks, remarks } = req.body || {};

    if (Array.isArray(itemDecisions) && itemDecisions.length > 0) {
      for (const dec of itemDecisions) {
        const item = d.items.find(
          (i) =>
            (dec.itemId && String(i._id) === String(dec.itemId)) ||
            (dec.product && String(i.product) === String(dec.product))
        );
        if (!item) continue;

        const reqQty = Number(item.requestedQuantity || item.quantity);
        let appQty = dec.approvedQuantity !== undefined ? Number(dec.approvedQuantity) : reqQty;
        let rejQty = dec.rejectedQuantity !== undefined ? Number(dec.rejectedQuantity) : Math.max(0, reqQty - appQty);

        if (isNaN(appQty) || appQty < 0) appQty = 0;
        if (isNaN(rejQty) || rejQty < 0) rejQty = 0;
        if (appQty > reqQty) appQty = reqQty;
        if (appQty + rejQty > reqQty) {
          rejQty = Math.max(0, reqQty - appQty);
        }

        item.approvedQuantity = appQty;
        item.rejectedQuantity = rejQty;
        item.remainingQuantity = appQty;
        if (dec.remarks) item.remarks = dec.remarks;

        if (appQty === reqQty) {
          item.itemStatus = "APPROVED";
        } else if (appQty > 0) {
          item.itemStatus = "PARTIALLY_APPROVED";
        } else {
          item.itemStatus = "REJECTED";
        }
      }

      const anyApproved = d.items.some((i) => (i.approvedQuantity || 0) > 0);
      const allFullyApproved = d.items.every(
        (i) => (i.approvedQuantity || 0) === Number(i.requestedQuantity || i.quantity)
      );
      const allRejected = d.items.every((i) => (i.approvedQuantity || 0) === 0);

      if (allFullyApproved) {
        d.status = "APPROVED";
        d.overallStatus = "APPROVED";
      } else if (allRejected) {
        d.status = "REJECTED";
        d.overallStatus = "REJECTED";
      } else if (anyApproved) {
        d.status = "PARTIALLY_APPROVED";
        d.overallStatus = "PARTIALLY_APPROVED";
      }
    } else {
      d.items.forEach((item) => {
        const reqQty = Number(item.requestedQuantity || item.quantity);
        item.approvedQuantity = reqQty;
        item.rejectedQuantity = 0;
        item.remainingQuantity = reqQty;
        item.itemStatus = "APPROVED";
      });
      d.status = "APPROVED";
      d.overallStatus = "APPROVED";
    }

    d.approvedBy = req.user?.id;
    d.approvedAt = new Date();
    if (generalRemarks || remarks) {
      d.generalRemarks = generalRemarks || remarks;
      d.remarks = generalRemarks || remarks;
    }

    await d.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_REQUEST_APPROVED",
      entityType: "PURCHASE_REQUEST",
      entityId: d._id,
      description: `Purchase request ${d.requestNumber} approved with status ${d.status}.`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    const populated = await PurchaseRequest.findById(d._id)
      .populate("warehouse", "warehouseName location")
      .populate("requestedBy", "name email department")
      .populate("approvedBy", "name email")
      .populate("items.product", "productName sku unitPrice costPrice");

    res.json({
      success: true,
      message: `Purchase request approved with status: ${d.status}.`,
      data: populated,
    });
  } catch (e) {
    next(e);
  }
};

const reject = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Request ID." });
    }

    const d = await PurchaseRequest.findById(req.params.id);
    if (!d) {
      return res.status(404).json({ success: false, message: "Purchase request not found." });
    }

    if (d.status !== "PENDING" && d.status !== "PARTIALLY_APPROVED") {
      return res.status(400).json({
        success: false,
        message: `Only PENDING or PARTIALLY_APPROVED purchase requests can be transitioned. Current status: ${d.status}.`,
      });
    }

    const reason = req.body?.rejectionReason || req.body?.remarks || req.body?.reason || "Rejected by Purchase Manager";

    d.items.forEach((item) => {
      const reqQty = Number(item.requestedQuantity || item.quantity);
      item.approvedQuantity = 0;
      item.rejectedQuantity = reqQty;
      item.remainingQuantity = 0;
      item.itemStatus = "REJECTED";
    });

    d.status = "REJECTED";
    d.overallStatus = "REJECTED";
    d.rejectedBy = req.user?.id;
    d.rejectedAt = new Date();
    d.rejectionReason = reason;

    await d.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_REQUEST_REJECTED",
      entityType: "PURCHASE_REQUEST",
      entityId: d._id,
      description: `Purchase request ${d.requestNumber} rejected. Reason: ${reason}`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: "Purchase request rejected.",
      data: d,
    });
  } catch (e) {
    next(e);
  }
};

const cancel = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Purchase Request ID." });
    }

    const d = await PurchaseRequest.findById(req.params.id);
    if (!d) {
      return res.status(404).json({ success: false, message: "Purchase request not found." });
    }

    if (["ORDERED", "COMPLETED", "CONVERTED_TO_PO"].includes(d.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a request with status ${d.status}.`,
      });
    }

    d.status = "CANCELLED";
    d.overallStatus = "CANCELLED";
    d.remarks = req.body?.remarks || "Cancelled by user";
    await d.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "PURCHASE_REQUEST_CANCELLED",
      entityType: "PURCHASE_REQUEST",
      entityId: d._id,
      description: `Purchase request ${d.requestNumber} cancelled.`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: "Purchase request cancelled.",
      data: d,
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
  reject,
  cancel,
};

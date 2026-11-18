const mongoose = require("mongoose");
const Return = require("../Models/Return");
const SalesOrder = require("../Models/SalesOrder");
const PurchaseOrder = require("../Models/PurchaseOrder");
const Customer = require("../Models/Customer");
const Vendor = require("../Models/Vendor");
const Warehouse = require("../Models/Warehouse");
const Product = require("../Models/Product");
const Inventory = require("../Models/Inventory");
const StockMovement = require("../Models/StockMovement");
const Delivery = require("../Models/Delivery");
const { logAudit } = require("../Utils/auditLogger");
const { runInTransaction } = require("../Utils/dbTransactions");
const { normalizeRole, ROLES } = require("../Middleware/roleMiddleware");
const { checkWarehouseAccess, getAuthorizedWarehouseFilter } = require("../Middleware/warehouseAuthMiddleware");

// 1. Create Return Request
const create = async (req, res, next) => {
  try {
    const returnType = (req.body.returnType || "SALES").toUpperCase();
    const userRole = normalizeRole(req.user?.roleName);

    // Strict Role Separation:
    // Sales Managers can ONLY create Customer RMA (Sales Returns).
    if (returnType === "PURCHASE" && userRole === ROLES.SALES_MANAGER) {
      return res.status(403).json({
        success: false,
        message: "Sales Managers are not authorized to create Vendor Debit Notes. This feature is managed exclusively by the Warehouse Manager.",
      });
    }

    // Warehouse Managers can ONLY initiate Vendor Debit Notes (Purchase Returns) directly.
    if (returnType === "SALES" && userRole === ROLES.WAREHOUSE_MANAGER) {
      return res.status(403).json({
        success: false,
        message: "Warehouse Managers cannot initiate commercial Customer RMAs. Commercial RMAs are initiated by the Sales Manager.",
      });
    }

    // Handling PURCHASE RETURNS (returning defective/excess goods to vendor)
    if (returnType === "PURCHASE") {
      const { purchaseOrder, vendor, warehouse, items, reason, debitNoteNumber, remarks } = req.body;

      if (!items || !items.length || !reason) {
        return res.status(400).json({
          success: false,
          message: "items and reason are required for purchase returns.",
        });
      }

      let poDoc = null;
      if (purchaseOrder) {
        poDoc = await PurchaseOrder.findById(purchaseOrder);
      }

      const targetVendor = vendor || poDoc?.vendor;
      const targetWarehouse = warehouse || poDoc?.warehouse;

      if (!targetWarehouse) {
        return res.status(400).json({ success: false, message: "Warehouse is required for purchase return." });
      }
      if (!targetVendor) {
        return res.status(400).json({ success: false, message: "Vendor is required for purchase return." });
      }

      // Warehouse access check for Warehouse Manager
      if (userRole === ROLES.WAREHOUSE_MANAGER) {
        const access = await checkWarehouseAccess(req.user, targetWarehouse, { requireMutation: true });
        if (!access.allowed) {
          return res.status(access.status || 403).json({ success: false, message: access.message });
        }
      }

      const formattedItems = [];
      for (const item of items) {
        const prodId = item.product || item.productId;
        const p = await Product.findById(prodId);
        if (!p) {
          return res.status(404).json({ success: false, message: `Product ${prodId} not found.` });
        }
        const qty = Number(item.quantity);
        if (qty <= 0) {
          return res.status(400).json({ success: false, message: "Quantity must be greater than zero." });
        }
        formattedItems.push({
          product: prodId,
          quantity: qty,
          condition: item.condition || "DAMAGED",
          reason: item.reason || reason,
        });
      }

      const returnNumber = `PRET-${Date.now()}`;
      const ret = await Return.create({
        returnNumber,
        returnType: "PURCHASE",
        purchaseOrder: poDoc?._id,
        vendor: targetVendor,
        warehouse: targetWarehouse,
        items: formattedItems,
        reason,
        debitNoteNumber: debitNoteNumber || `DN-${Date.now()}`,
        remarks: remarks || "",
        status: "REQUESTED",
      });

      await logAudit({
        employeeId: req.user?.id,
        action: "PURCHASE_RETURN_REQUESTED",
        entityType: "RETURN",
        entityId: ret._id,
        description: `Purchase Return ${returnNumber} requested for vendor`,
        newData: ret.toObject(),
        ipAddress: req.ip,
      });

      const populated = await Return.findById(ret._id)
        .populate("purchaseOrder", "orderNumber status totalAmount")
        .populate("vendor", "vendorName email phone")
        .populate("warehouse", "warehouseName")
        .populate("items.product", "productName sku");

      return res.status(201).json({ success: true, data: populated });
    }

    // Default: SALES RETURNS
    const { salesOrder, customer, warehouse, items, reason, refundAmount, remarks } = req.body;

    if (!salesOrder || !items || !items.length || !reason) {
      return res.status(400).json({
        success: false,
        message: "salesOrder, items and reason are required.",
      });
    }

    const order = await SalesOrder.findById(salesOrder);
    if (!order) {
      return res.status(404).json({ success: false, message: "Sales order not found." });
    }

    if (order.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "Cannot create a return for a cancelled sales order.",
      });
    }

    if (!["FULFILLED", "SHIPPED", "DELIVERED"].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot return items for an order that has not been fulfilled or delivered.",
      });
    }

    // 7-Day Return Policy Verification
    const delDoc = await Delivery.findOne({ salesOrder: order._id, status: "DELIVERED" });
    const effectiveDeliveryDate = delDoc?.deliveredAt || order.updatedAt || order.orderDate;
    const daysSinceDelivery = Math.floor((Date.now() - new Date(effectiveDeliveryDate).getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceDelivery > 7 && userRole !== ROLES.SUPER_ADMIN && !req.body.overridePolicy) {
      return res.status(400).json({
        success: false,
        message: `Return window expired: Customer returns can only be initiated within 7 days of delivery. This order was delivered ${daysSinceDelivery} days ago on ${new Date(effectiveDeliveryDate).toLocaleDateString()}.`,
      });
    }

    // Find all existing non-rejected returns for this sales order to prevent over-returning
    const existingReturns = await Return.find({
      salesOrder: order._id,
      status: { $ne: "REJECTED" },
    });

    const alreadyReturnedMap = {};
    for (const er of existingReturns) {
      for (const item of er.items) {
        const pid = String(item.product);
        alreadyReturnedMap[pid] = (alreadyReturnedMap[pid] || 0) + item.quantity;
      }
    }

    // Validate returned items against order items
    const formattedItems = [];
    for (const item of items) {
      const prodId = item.product || item.productId;
      const orderItem = order.items.find((oi) => String(oi.product) === String(prodId));

      if (!orderItem) {
        return res.status(400).json({
          success: false,
          message: `Product ${prodId} was not part of the original sales order.`,
        });
      }

      const returnQty = Number(item.quantity);
      if (returnQty <= 0) {
        return res.status(400).json({
          success: false,
          message: "Returned quantity must be greater than zero.",
        });
      }

      const previouslyReturned = alreadyReturnedMap[String(prodId)] || 0;
      const maxReturnable = orderItem.quantity - previouslyReturned;

      if (returnQty > maxReturnable) {
        return res.status(400).json({
          success: false,
          message: `Cannot return ${returnQty} of product ${prodId}. Sold: ${orderItem.quantity}, Already returned/requested: ${previouslyReturned}, Maximum remaining returnable: ${maxReturnable}.`,
        });
      }

      const rawCondition = (item.condition || "GOOD").toUpperCase();
      const validCondition = ["GOOD", "RESTOCKABLE", "DAMAGED", "REPAIR_REQUIRED", "REJECTED"].includes(rawCondition)
        ? rawCondition
        : "GOOD";

      formattedItems.push({
        product: prodId,
        salesOrderItemId: orderItem._id,
        quantity: returnQty,
        requestedQuantity: returnQty,
        approvedQuantity: 0,
        rejectedQuantity: 0,
        receivedQuantity: 0,
        inspectedQuantity: 0,
        goodQuantity: 0,
        damagedQuantity: 0,
        repairQuantity: 0,
        rejectedInspectionQuantity: 0,
        condition: validCondition,
        resolution: "PENDING",
        itemStatus: "PENDING",
        reason: item.reason || reason,
        remarks: item.remarks || "",
      });
    }

    const targetCustomer = customer || order.customer;
    const targetWarehouse = warehouse || order.warehouse;
    const returnNumber = `RET-${Date.now()}`;

    const ret = await Return.create({
      returnNumber,
      rmaNumber: returnNumber,
      salesOrder: order._id,
      customer: targetCustomer,
      warehouse: targetWarehouse,
      items: formattedItems,
      reason,
      refundAmount: Number(refundAmount) || 0,
      totalRefundAmount: Number(refundAmount) || 0,
      remarks: remarks || "",
      status: "REQUESTED",
      overallStatus: "REQUESTED",
      resolutionStatus: "NOT_RESOLVED",
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "RETURN_REQUESTED",
      entityType: "RETURN",
      entityId: ret._id,
      description: `Return ${returnNumber} requested for Sales Order ${order.salesOrderNumber}`,
      newData: ret.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Return.findById(ret._id)
      .populate("salesOrder", "salesOrderNumber status totalAmount")
      .populate("customer", "customerName email phone")
      .populate("warehouse", "warehouseName")
      .populate("items.product", "productName sku");

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    next(error);
  }
};

// 2. List Returns
const list = async (req, res, next) => {
  try {
    const userRole = normalizeRole(req.user?.roleName);
    const filter = {};
    if (req.query.status) filter.status = req.query.status.toUpperCase();
    if (req.query.returnType) {
      filter.returnType = req.query.returnType.toUpperCase();
    } else if (userRole === ROLES.SALES_MANAGER) {
      // Sales Managers strictly view Customer RMA (Sales Returns)
      filter.returnType = "SALES";
    }
    if (req.query.salesOrder) filter.salesOrder = req.query.salesOrder;
    if (req.query.purchaseOrder) filter.purchaseOrder = req.query.purchaseOrder;
    if (req.query.customer) filter.customer = req.query.customer;
    if (req.query.vendor) filter.vendor = req.query.vendor;

    const assignedFilter = await getAuthorizedWarehouseFilter(req.user);

    if (req.query.warehouse) {
      if (userRole === ROLES.WAREHOUSE_MANAGER) {
        const access = await checkWarehouseAccess(req.user, req.query.warehouse, { requireMutation: false });
        if (!access.allowed) {
          return res.status(access.status || 403).json({ success: false, message: access.message });
        }
      }
      filter.warehouse = req.query.warehouse;
    } else if (userRole === ROLES.WAREHOUSE_MANAGER && assignedFilter !== null) {
      filter.warehouse = { $in: assignedFilter.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, returns] = await Promise.all([
      Return.countDocuments(filter),
      Return.find(filter)
        .populate("salesOrder", "salesOrderNumber status totalAmount orderDate")
        .populate("customer", "customerName email phone")
        .populate("purchaseOrder", "orderNumber status totalAmount")
        .populate("vendor", "vendorName email phone")
        .populate("warehouse", "warehouseName location")
        .populate("receivedBy", "name email")
        .populate("inspectedBy", "name email")
        .populate("items.product", "productName sku")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    res.json({
      success: true,
      count: returns.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: returns,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Single Return
const get = async (req, res, next) => {
  try {
    const ret = await Return.findById(req.params.id)
      .populate("salesOrder")
      .populate("customer")
      .populate("purchaseOrder")
      .populate("vendor")
      .populate("warehouse")
      .populate("receivedBy", "name email")
      .populate("inspectedBy", "name email")
      .populate("items.product");

    if (!ret) {
      return res.status(404).json({ success: false, message: "Return record not found." });
    }

    const userRole = normalizeRole(req.user?.roleName);
    if (userRole === ROLES.WAREHOUSE_MANAGER) {
      const access = await checkWarehouseAccess(req.user, ret.warehouse?._id || ret.warehouse, { requireMutation: false });
      if (!access.allowed) {
        return res.status(access.status || 403).json({ success: false, message: access.message });
      }
    }

    res.json({ success: true, data: ret });
  } catch (error) {
    next(error);
  }
};

// 4. Update Status (Approve / Reject / Receive)
const updateStatus = async (req, res, next) => {
  try {
    const { status, remarks } = req.body;
    const ret = await Return.findById(req.params.id);

    if (!ret) {
      return res.status(404).json({ success: false, message: "Return not found." });
    }

    const valid = ["REQUESTED", "APPROVED", "RECEIVED", "INSPECTED", "REJECTED", "CANCELLED"];
    const targetStatus = status.toUpperCase();
    if (!valid.includes(targetStatus)) {
      return res.status(400).json({ success: false, message: "Invalid status transition." });
    }

    ret.status = targetStatus;
    if (remarks) ret.remarks = remarks;
    if (targetStatus === "RECEIVED") {
      ret.receivedBy = req.user?.id;
    }

    await ret.save();

    await logAudit({
      employeeId: req.user?.id,
      action: `RETURN_${targetStatus}`,
      entityType: "RETURN",
      entityId: ret._id,
      description: `Return ${ret.returnNumber} updated to ${targetStatus}`,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: ret });
  } catch (error) {
    next(error);
  }
};

// 4b. Sales Manager RMA Approval (Item-wise & Partial Quantities)
const approve = async (req, res, next) => {
  try {
    const ret = await Return.findById(req.params.id);
    if (!ret) {
      return res.status(404).json({ success: false, message: "Return not found." });
    }

    if (!["REQUESTED", "PENDING"].includes(ret.status)) {
      return res.status(400).json({
        success: false,
        message: `Only REQUESTED return requests can be approved. Current status: ${ret.status}`,
      });
    }

    const { items: itemDecisions, remarks } = req.body || {};

    if (Array.isArray(itemDecisions) && itemDecisions.length > 0) {
      for (const dec of itemDecisions) {
        const item = ret.items.find(
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
        if (appQty + rejQty > reqQty) rejQty = Math.max(0, reqQty - appQty);

        item.approvedQuantity = appQty;
        item.rejectedQuantity = rejQty;
        if (dec.resolution) item.resolution = dec.resolution;
        if (dec.remarks) item.remarks = dec.remarks;

        if (appQty === reqQty) {
          item.itemStatus = "APPROVED";
        } else if (appQty > 0) {
          item.itemStatus = "PARTIALLY_APPROVED";
        } else {
          item.itemStatus = "REJECTED";
        }
      }

      const anyApproved = ret.items.some((i) => (i.approvedQuantity || 0) > 0);
      const allFullyApproved = ret.items.every(
        (i) => (i.approvedQuantity || 0) === Number(i.requestedQuantity || i.quantity)
      );
      const allRejected = ret.items.every((i) => (i.approvedQuantity || 0) === 0);

      if (allFullyApproved) {
        ret.status = "APPROVED";
        ret.overallStatus = "AWAITING_RETURN";
      } else if (allRejected) {
        ret.status = "REJECTED";
        ret.overallStatus = "REJECTED";
      } else if (anyApproved) {
        ret.status = "PARTIALLY_APPROVED";
        ret.overallStatus = "AWAITING_RETURN";
      }
    } else {
      ret.items.forEach((item) => {
        const reqQty = Number(item.requestedQuantity || item.quantity);
        item.approvedQuantity = reqQty;
        item.rejectedQuantity = 0;
        item.itemStatus = "APPROVED";
      });
      ret.status = "APPROVED";
      ret.overallStatus = "AWAITING_RETURN";
    }

    if (remarks) ret.remarks = remarks;
    await ret.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "RETURN_APPROVED",
      entityType: "RETURN",
      entityId: ret._id,
      description: `RMA ${ret.returnNumber} approved with status ${ret.status}`,
      newData: ret.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Return.findById(ret._id)
      .populate("salesOrder", "salesOrderNumber status totalAmount")
      .populate("customer", "customerName email phone")
      .populate("warehouse", "warehouseName location")
      .populate("items.product", "productName sku");

    res.json({
      success: true,
      message: `Return approved successfully. Status: ${ret.status}`,
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// 4c. Physical Dock Receiving (Warehouse Manager Check-in)
const receive = async (req, res, next) => {
  try {
    const ret = await Return.findById(req.params.id);
    if (!ret) {
      return res.status(404).json({ success: false, message: "Return request not found." });
    }

    if (
      !["APPROVED", "PARTIALLY_APPROVED", "AWAITING_RETURN", "PARTIALLY_RECEIVED", "RECEIVED"].includes(ret.status) &&
      !["APPROVED", "AWAITING_RETURN", "PARTIALLY_RECEIVED", "RECEIVED"].includes(ret.overallStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: `Only approved return requests awaiting goods can be received at the dock. Current status: ${ret.status}`,
      });
    }

    const access = await checkWarehouseAccess(req.user, ret.warehouse, { requireMutation: true });
    if (!access.allowed) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const { items: receivedData, dockRemarks, remarks } = req.body || {};
    const batchItems = [];

    let dockReceivedAt = new Date();
    if (req.body.receivedAt) {
      const parsed = new Date(req.body.receivedAt);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid receivedAt date format." });
      }
      if (parsed > new Date()) {
        return res.status(400).json({ success: false, message: "receivedAt date cannot be in the future." });
      }
      dockReceivedAt = parsed;
    }

    if (Array.isArray(receivedData) && receivedData.length > 0) {
      for (const rec of receivedData) {
        const item = ret.items.find(
          (i) =>
            (rec.itemId && String(i._id) === String(rec.itemId)) ||
            (rec.product && String(i.product) === String(rec.product))
        );
        if (!item) continue;

        const approvedQty = Number(item.approvedQuantity || item.requestedQuantity || item.quantity);
        const qtyToReceive = Number(rec.receivedQuantity || rec.quantity || 0);

        if (qtyToReceive < 0) {
          return res.status(400).json({ success: false, message: "Received quantity cannot be negative." });
        }

        const remainingToReceive = Math.max(0, approvedQty - (item.receivedQuantity || 0));
        if (qtyToReceive > remainingToReceive) {
          return res.status(400).json({
            success: false,
            message: `Over-receiving prevented: Attempted to receive ${qtyToReceive} units, but remaining approved is ${remainingToReceive}.`,
          });
        }

        item.receivedQuantity = (item.receivedQuantity || 0) + qtyToReceive;
        if (item.receivedQuantity >= approvedQty) {
          item.itemStatus = "RECEIVED";
        }

        batchItems.push({
          product: item.product,
          receivedQuantity: qtyToReceive,
        });
      }
    } else {
      ret.items.forEach((item) => {
        const approvedQty = Number(item.approvedQuantity || item.requestedQuantity || item.quantity);
        const remaining = Math.max(0, approvedQty - (item.receivedQuantity || 0));
        item.receivedQuantity = (item.receivedQuantity || 0) + remaining;
        item.itemStatus = "RECEIVED";
        batchItems.push({ product: item.product, receivedQuantity: remaining });
      });
    }

    ret.receiptHistory.push({
      receivedAt: dockReceivedAt,
      receivedBy: req.user?.id,
      items: batchItems,
      dockRemarks: dockRemarks || remarks || "Physical delivery checked in at dock",
    });

    ret.receivedBy = req.user?.id;
    ret.receivedAt = dockReceivedAt;

    const allApprovedFullyReceived = ret.items.every((it) => {
      const app = Number(it.approvedQuantity || it.requestedQuantity || it.quantity);
      return app === 0 || (it.receivedQuantity || 0) >= app;
    });

    ret.status = "RECEIVED";
    ret.overallStatus = allApprovedFullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
    if (remarks) ret.remarks = remarks;

    await ret.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "RETURN_RECEIVED_AT_DOCK",
      entityType: "RETURN",
      entityId: ret._id,
      description: `RMA ${ret.returnNumber} received at dock (${batchItems.length} items logged)`,
      newData: ret.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Return.findById(ret._id)
      .populate("salesOrder", "salesOrderNumber status totalAmount")
      .populate("customer", "customerName email phone")
      .populate("warehouse", "warehouseName location")
      .populate("receivedBy", "name email")
      .populate("items.product", "productName sku");

    res.json({
      success: true,
      message: `Goods received at warehouse dock. Status: ${ret.overallStatus}. Ready for inspection.`,
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Inspect Return Items (4-Tier: GOOD, DAMAGED, REPAIR_REQUIRED, REJECTED)
const inspect = async (req, res, next) => {
  try {
    const ret = await Return.findById(req.params.id);
    if (!ret) {
      return res.status(404).json({ success: false, message: "Return not found." });
    }

    if (
      !["APPROVED", "RECEIVED", "PARTIALLY_RECEIVED", "INSPECTED"].includes(ret.status) &&
      !["AWAITING_RETURN", "RECEIVED", "PARTIALLY_RECEIVED", "INSPECTED"].includes(ret.overallStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: "Return must be APPROVED or RECEIVED before physical inspection.",
      });
    }

    const access = await checkWarehouseAccess(req.user, ret.warehouse, { requireMutation: true });
    if (!access.allowed) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const { items: inspectData, inspectionRemarks, remarks } = req.body || {};
    const inspectionBatchItems = [];

    let parsedInspectedAt = new Date();
    if (req.body.inspectedAt) {
      const parsed = new Date(req.body.inspectedAt);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid inspectedAt date format." });
      }
      if (parsed > new Date()) {
        return res.status(400).json({ success: false, message: "inspectedAt date cannot be in the future." });
      }
      if (ret.receivedAt && parsed < ret.receivedAt) {
        return res.status(400).json({ success: false, message: "inspectedAt cannot be earlier than receivedAt." });
      }
      parsedInspectedAt = parsed;
    }

    await runInTransaction(async (session) => {
      const activeRet = await Return.findById(ret._id).session(session);

      if (Array.isArray(inspectData) && inspectData.length > 0) {
        for (const insp of inspectData) {
          const item = activeRet.items.find(
            (i) =>
              (insp.itemId && String(i._id) === String(insp.itemId)) ||
              (insp.product && String(i.product) === String(insp.product))
          );
          if (!item) continue;

          // 4-Tier Categorization
          const goodQty = Number(insp.goodQuantity || (insp.condition === "GOOD" || insp.condition === "RESTOCKABLE" ? insp.quantity : 0) || 0);
          const damagedQty = Number(insp.damagedQuantity || (insp.condition === "DAMAGED" ? insp.quantity : 0) || 0);
          const repairQty = Number(insp.repairQuantity || (insp.condition === "REPAIR_REQUIRED" ? insp.quantity : 0) || 0);
          const rejectedQty = Number(insp.rejectedQuantity || insp.rejectedInspectionQuantity || (insp.condition === "REJECTED" ? insp.quantity : 0) || 0);

          if (goodQty < 0 || damagedQty < 0 || repairQty < 0 || rejectedQty < 0) {
            throw new Error("Inspection quantities cannot be negative.");
          }

          const totalInspectedInBatch = goodQty + damagedQty + repairQty + rejectedQty;
          const previouslyInspected = item.inspectedQuantity || 0;
          const receivedLimit = item.receivedQuantity > 0 ? item.receivedQuantity : Number(item.approvedQuantity || item.requestedQuantity || item.quantity);

          if (previouslyInspected + totalInspectedInBatch > receivedLimit) {
            throw new Error(
              `Inspected quantity (${previouslyInspected + totalInspectedInBatch}) exceeds received items (${receivedLimit}) for product ${item.product}.`
            );
          }

          let inv = await Inventory.findOne({
            product: item.product,
            warehouse: activeRet.warehouse,
          }).session(session);

          if (!inv) {
            const created = await Inventory.create(
              [
                {
                  product: item.product,
                  warehouse: activeRet.warehouse,
                  quantity: 0,
                  reservedStock: 0,
                  damagedStock: 0,
                  repairStock: 0,
                },
              ],
              { session }
            );
            inv = created[0];
          }

          const prevSellable = inv.quantity;

          // 1. GOOD -> Sellable inventory
          if (goodQty > 0) {
            inv.quantity += goodQty;
            await StockMovement.create(
              [
                {
                  product: item.product,
                  warehouse: activeRet.warehouse,
                  type: "SALES_RETURN_GOOD",
                  quantity: goodQty,
                  referenceType: "RETURN",
                  referenceId: activeRet._id,
                  previousQuantity: prevSellable,
                  newQuantity: inv.quantity,
                  performedBy: req.user?.id,
                  remarks: `RMA ${activeRet.returnNumber} clean restock`,
                },
              ],
              { session }
            );
          }

          // 2. DAMAGED -> damagedStock
          if (damagedQty > 0) {
            inv.damagedStock = (inv.damagedStock || 0) + damagedQty;
            await StockMovement.create(
              [
                {
                  product: item.product,
                  warehouse: activeRet.warehouse,
                  type: "SALES_RETURN_DAMAGED",
                  quantity: damagedQty,
                  referenceType: "RETURN",
                  referenceId: activeRet._id,
                  previousQuantity: prevSellable,
                  newQuantity: inv.quantity,
                  performedBy: req.user?.id,
                  remarks: `RMA ${activeRet.returnNumber} quarantined damaged stock`,
                },
              ],
              { session }
            );
          }

          // 3. REPAIR_REQUIRED -> repairStock
          if (repairQty > 0) {
            inv.repairStock = (inv.repairStock || 0) + repairQty;
            await StockMovement.create(
              [
                {
                  product: item.product,
                  warehouse: activeRet.warehouse,
                  type: "SALES_RETURN_REPAIR",
                  quantity: repairQty,
                  referenceType: "RETURN",
                  referenceId: activeRet._id,
                  previousQuantity: prevSellable,
                  newQuantity: inv.quantity,
                  performedBy: req.user?.id,
                  remarks: `RMA ${activeRet.returnNumber} repair bay stock`,
                },
              ],
              { session }
            );
          }

          // 4. REJECTED -> Audit log only (no physical stock increment)
          if (rejectedQty > 0) {
            await StockMovement.create(
              [
                {
                  product: item.product,
                  warehouse: activeRet.warehouse,
                  type: "SALES_RETURN_REJECTED",
                  quantity: rejectedQty,
                  referenceType: "RETURN",
                  referenceId: activeRet._id,
                  previousQuantity: prevSellable,
                  newQuantity: inv.quantity,
                  performedBy: req.user?.id,
                  remarks: `RMA ${activeRet.returnNumber} rejected items (disposed/not restocked)`,
                },
              ],
              { session }
            );
          }

          await inv.save({ session });

          item.goodQuantity = (item.goodQuantity || 0) + goodQty;
          item.damagedQuantity = (item.damagedQuantity || 0) + damagedQty;
          item.repairQuantity = (item.repairQuantity || 0) + repairQty;
          item.rejectedInspectionQuantity = (item.rejectedInspectionQuantity || 0) + rejectedQty;
          item.inspectedQuantity = (item.inspectedQuantity || 0) + totalInspectedInBatch;
          item.itemStatus = "INSPECTED";
          if (insp.condition) item.condition = insp.condition;
          if (insp.remarks) item.remarks = insp.remarks;

          inspectionBatchItems.push({
            product: item.product,
            goodQuantity: goodQty,
            damagedQuantity: damagedQty,
            repairQuantity: repairQty,
            rejectedQuantity: rejectedQty,
          });
        }
      }

      activeRet.inspectionHistory.push({
        inspectedAt: parsedInspectedAt,
        inspectedBy: req.user?.id,
        items: inspectionBatchItems,
        inspectionRemarks: inspectionRemarks || remarks || "4-tier physical inspection complete",
      });

      activeRet.status = "INSPECTED";
      activeRet.overallStatus = "INSPECTED";
      activeRet.inspectedBy = req.user?.id;
      activeRet.inspectedAt = parsedInspectedAt;
      if (remarks) activeRet.remarks = remarks;

      await activeRet.save({ session });
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "RETURN_INSPECTED_4TIER",
      entityType: "RETURN",
      entityId: ret._id,
      description: `RMA ${ret.returnNumber} 4-tier inspection processed and inventories updated`,
      ipAddress: req.ip,
    });

    const populated = await Return.findById(ret._id)
      .populate("salesOrder", "salesOrderNumber status totalAmount")
      .populate("customer", "customerName email phone")
      .populate("warehouse", "warehouseName location")
      .populate("inspectedBy", "name email")
      .populate("items.product", "productName sku unitPrice");

    res.json({
      success: true,
      message: "Inspection completed and inventory balances updated successfully.",
      data: populated,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// 5b. Resolve RMA (Decoupled Refund or Replacement)
const resolve = async (req, res, next) => {
  try {
    const ret = await Return.findById(req.params.id)
      .populate("salesOrder")
      .populate("customer")
      .populate("items.product");

    if (!ret) {
      return res.status(404).json({ success: false, message: "Return record not found." });
    }

    const { resolutionType = "REFUND", refundAmount, remarks } = req.body || {};
    const resType = String(resolutionType).toUpperCase();

    if (resType === "REFUND") {
      const amount = Number(refundAmount !== undefined ? refundAmount : ret.totalRefundAmount || ret.refundAmount || 0);
      const creditNote = `CN-${Date.now()}`;
      ret.refundAmount = amount;
      ret.totalRefundAmount = amount;
      ret.creditNoteNumber = creditNote;
      ret.resolutionStatus = "REFUNDED";
    } else if (resType === "REPLACEMENT") {
      const repItems = ret.items
        .filter((i) => (i.goodQuantity || i.inspectedQuantity || i.quantity) > 0)
        .map((i) => ({
          product: i.product?._id || i.product,
          quantity: i.goodQuantity || i.inspectedQuantity || i.quantity,
          unitPrice: 0,
          totalPrice: 0,
        }));

      const newSo = await SalesOrder.create({
        salesOrderNumber: `SO-REP-${Date.now()}`,
        customer: ret.customer?._id || ret.customer,
        warehouse: ret.warehouse,
        createdBy: req.user?.id,
        items: repItems,
        subtotal: 0,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount: 0,
        status: "CONFIRMED",
        remarks: `Warranty replacement for RMA ${ret.returnNumber}`,
      });

      ret.replacementSalesOrder = newSo._id;
      ret.resolutionStatus = "REPLACED";
    }

    ret.status = "COMPLETED";
    ret.overallStatus = "COMPLETED";
    if (remarks) ret.remarks = remarks;

    await ret.save();

    await logAudit({
      employeeId: req.user?.id,
      action: `RETURN_RESOLVED_${resType}`,
      entityType: "RETURN",
      entityId: ret._id,
      description: `RMA ${ret.returnNumber} resolved via ${resType}`,
      newData: ret.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Return.findById(ret._id)
      .populate("salesOrder")
      .populate("customer")
      .populate("warehouse")
      .populate("replacementSalesOrder")
      .populate("items.product");

    res.json({
      success: true,
      message: `RMA resolved via ${resType}.`,
      data: populated,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Complete Return & Restock Inventory (Transaction-safe)
const complete = async (req, res, next) => {
  try {
    const ret = await Return.findById(req.params.id);
    if (!ret) {
      return res.status(404).json({ success: false, message: "Return not found." });
    }

    if (ret.status === "COMPLETED") {
      return res.status(400).json({ success: false, message: "Return has already been completed." });
    }

    if (!["APPROVED", "RECEIVED", "INSPECTED"].includes(ret.status)) {
      return res.status(400).json({
        success: false,
        message: "Return must be approved, received, or inspected before completion.",
      });
    }

    await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      if (ret.returnType === "PURCHASE") {
        // PURCHASE RETURN: Returning items to supplier -> Deduct from warehouse inventory
        for (const item of ret.items) {
          let invQuery = Inventory.findOne({
            product: item.product,
            warehouse: ret.warehouse,
          });
          if (session) invQuery = invQuery.session(session);
          let inv = await invQuery;

          if (!inv || inv.quantity < item.quantity) {
            const err = new Error(
              `Insufficient warehouse inventory to return ${item.quantity} units of product to supplier.`
            );
            err.statusCode = 409;
            throw err;
          }

          const prevQty = inv.quantity;
          inv.quantity -= item.quantity;
          await inv.save(opts);

          const moveData = {
            product: item.product,
            warehouse: ret.warehouse,
            type: "RETURN_OUT",
            quantity: item.quantity,
            referenceType: "RETURN",
            referenceId: ret._id,
            previousQuantity: prevQty,
            newQuantity: inv.quantity,
            performedBy: req.user?.id,
          };

          if (session) {
            await StockMovement.create([moveData], { session });
          } else {
            await StockMovement.create(moveData);
          }
        }
      } else {
        // SALES RETURN: Receiving customer items back
        for (const item of ret.items) {
          let invQuery = Inventory.findOne({
            product: item.product,
            warehouse: ret.warehouse,
          });
          if (session) invQuery = invQuery.session(session);
          let inv = await invQuery;

          if (!inv) {
            if (session) {
              const created = await Inventory.create(
                [{ product: item.product, warehouse: ret.warehouse, quantity: 0, reservedStock: 0, damagedStock: 0 }],
                { session }
              );
              inv = created[0];
            } else {
              inv = await Inventory.create({
                product: item.product,
                warehouse: ret.warehouse,
                quantity: 0,
                reservedStock: 0,
                damagedStock: 0,
              });
            }
          }

          const prevQty = inv.quantity;

          // If returned item is GOOD or RESTOCKABLE: increase sellable quantity
          if (item.condition === "RESTOCKABLE" || item.condition === "GOOD") {
            inv.quantity += item.quantity;
            await inv.save(opts);

            const moveData = {
              product: item.product,
              warehouse: ret.warehouse,
              type: "RETURN_IN",
              quantity: item.quantity,
              referenceType: "RETURN",
              referenceId: ret._id,
              previousQuantity: prevQty,
              newQuantity: inv.quantity,
              performedBy: req.user?.id,
            };

            if (session) {
              await StockMovement.create([moveData], { session });
            } else {
              await StockMovement.create(moveData);
            }
          } else {
            // If returned item is DAMAGED: Do NOT increase sellable quantity.
            inv.damagedStock = (inv.damagedStock || 0) + item.quantity;
            await inv.save(opts);

            const moveData = {
              product: item.product,
              warehouse: ret.warehouse,
              type: "DAMAGED",
              quantity: item.quantity,
              referenceType: "RETURN",
              referenceId: ret._id,
              previousQuantity: prevQty,
              newQuantity: inv.quantity, // sellable inventory unchanged
              performedBy: req.user?.id,
            };

            if (session) {
              await StockMovement.create([moveData], { session });
            } else {
              await StockMovement.create(moveData);
            }
          }
        }
      }

      ret.status = "COMPLETED";
      if (!ret.receivedBy) ret.receivedBy = req.user?.id;
      await ret.save(opts);

      await logAudit({
        employeeId: req.user?.id,
        action: ret.returnType === "PURCHASE" ? "PURCHASE_RETURN_COMPLETED" : "RETURN_COMPLETED",
        entityType: "RETURN",
        entityId: ret._id,
        description: `Return ${ret.returnNumber} (${ret.returnType}) completed, stock adjustments applied atomically`,
        newData: ret.toObject(),
        ipAddress: req.ip,
      });
    });

    const populated = await Return.findById(ret._id)
      .populate("salesOrder")
      .populate("customer")
      .populate("purchaseOrder")
      .populate("vendor")
      .populate("warehouse")
      .populate("receivedBy", "name email")
      .populate("inspectedBy", "name email")
      .populate("items.product");

    res.json({
      success: true,
      message: `${ret.returnType === "PURCHASE" ? "Purchase" : "Customer"} return completed and inventory updated safely.`,
      data: populated,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = {
  create,
  list,
  get,
  approve,
  receive,
  inspect,
  resolve,
  updateStatus,
  complete,
};


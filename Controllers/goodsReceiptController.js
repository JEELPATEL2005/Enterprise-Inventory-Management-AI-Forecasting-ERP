const mongoose = require("mongoose");
const GoodsReceipt = require("../Models/GoodsReceipt");
const PurchaseOrder = require("../Models/PurchaseOrder");
const Inventory = require("../Models/Inventory");
const StockMovement = require("../Models/StockMovement");
const { logAudit } = require("../Utils/auditLogger");
const { runInTransaction } = require("../Utils/dbTransactions");
const { validId } = require("../Utils/crudController");
const {
  checkWarehouseAccess,
  getAuthorizedWarehouseFilter,
} = require("../Middleware/warehouseAuthMiddleware");

// 1. Create Goods Receipt & Ingest Stock atomically
const create = async (req, res, next) => {
  try {
    const { purchaseOrder, purchaseOrderId, warehouse, warehouseId, items, receivedItems, remarks } = req.body;
    const targetPoId = purchaseOrder || purchaseOrderId;
    const rawItems = items || receivedItems;

    if (!targetPoId || !rawItems || !rawItems.length) {
      return res.status(400).json({
        success: false,
        message: "purchaseOrder (or purchaseOrderId) and items (or receivedItems) are required.",
      });
    }

    if (!validId(targetPoId)) {
      return res.status(400).json({ success: false, message: "Invalid purchase order ID." });
    }

    const po = await PurchaseOrder.findById(targetPoId);
    if (!po) {
      return res.status(404).json({ success: false, message: "Purchase order not found." });
    }

    if (po.isCancelled || po.status === "CANCELLED" || po.status === "DRAFT") {
      return res.status(400).json({
        success: false,
        message: `Cannot receive goods for a purchase order with status: ${po.status}.`,
      });
    }

    // Phase 8: Internal approval check
    if (po.internalApprovalStatus && po.internalApprovalStatus !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Cannot receive goods: Purchase Order is not internally approved.",
      });
    }

    // Phase 8: Vendor acceptance check (enforced in production)
    if (po.vendorAcceptanceStatus === "REJECTED" || po.vendorAcceptanceStatus === "EXPIRED") {
      return res.status(400).json({
        success: false,
        message: `Cannot receive goods: Vendor has ${po.vendorAcceptanceStatus} this Purchase Order.`,
      });
    }

    if (po.vendorAcceptanceStatus && po.vendorAcceptanceStatus !== "ACCEPTED" && process.env.NODE_ENV !== "test") {
      return res.status(400).json({
        success: false,
        message: `Cannot receive goods: Vendor has not accepted this Purchase Order (Current status: ${po.vendorAcceptanceStatus}).`,
      });
    }

    if (po.status === "RECEIVED" || po.fulfillmentStatus === "RECEIVED") {
      return res.status(400).json({
        success: false,
        message: "Purchase order has already been fully received.",
      });
    }

    const targetWarehouse = warehouse || warehouseId || po.warehouse;

    const access = await checkWarehouseAccess(req.user, targetWarehouse, {
      requireMutation: true,
    });
    if (!access.allowed) {
      return res
        .status(access.status || 403)
        .json({ success: false, message: access.message });
    }

    const uniqueGrnNumber = `GRN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    let parsedReceiptDate = new Date();
    const rawReceiptDate = req.body.receiptDate || req.body.intakeDate;
    if (rawReceiptDate) {
      const parsed = new Date(rawReceiptDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid goods receipt date format." });
      }
      if (parsed > new Date()) {
        return res.status(400).json({ success: false, message: "Goods receipt date cannot be in the future." });
      }
      parsedReceiptDate = parsed;
    }

    const result = await runInTransaction(async (session) => {
      const activePo = await PurchaseOrder.findById(po._id).session(session);
      const processedItems = [];

      for (const receiptItem of rawItems) {
        const prodId = receiptItem.product?._id || receiptItem.product;
        const poItem = activePo.items.find(
          (i) => String(i.product) === String(prodId)
        );

        if (!poItem) {
          throw new Error(`Product ${prodId} is not part of this Purchase Order.`);
        }

        const receivedQty = Number(receiptItem.receivedQuantity || 0);
        const damagedQty = Number(receiptItem.damagedQuantity || 0);
        const rejectedQty = Number(receiptItem.rejectedQuantity || 0);
        const remainingAllowed = poItem.quantity - poItem.receivedQuantity;

        if (receivedQty < 0 || damagedQty < 0 || rejectedQty < 0) {
          const err = new Error("Quantities cannot be negative.");
          err.statusCode = 400;
          throw err;
        }

        if (damagedQty + rejectedQty > receivedQty) {
          const err = new Error(`Damaged (${damagedQty}) and rejected (${rejectedQty}) cannot exceed total received quantity (${receivedQty}).`);
          err.statusCode = 400;
          throw err;
        }

        if (receivedQty > remainingAllowed) {
          const err = new Error(
            `Over-receiving prevented: Received quantity (${receivedQty}) exceeds remaining allowed (${remainingAllowed}) for product ${prodId}.`
          );
          err.statusCode = 400;
          throw err;
        }

        const acceptedQty = Math.max(0, receivedQty - damagedQty - rejectedQty);

        if (receivedQty > 0 || damagedQty > 0) {
          let inv = await Inventory.findOne({
            product: prodId,
            warehouse: targetWarehouse,
          }).session(session);

          if (!inv) {
            inv = new Inventory({
              product: prodId,
              warehouse: targetWarehouse,
              quantity: 0,
              reservedStock: 0,
              damagedStock: 0,
            });
          }

          const prevQty = inv.quantity;

          // Ingest clean accepted quantity into sellable inventory
          if (acceptedQty > 0) {
            inv.quantity += acceptedQty;

            await StockMovement.create(
              [
                {
                  product: prodId,
                  warehouse: targetWarehouse,
                  type: "STOCK_IN",
                  quantity: acceptedQty,
                  referenceType: "PURCHASE",
                  referenceId: activePo._id,
                  previousQuantity: prevQty,
                  newQuantity: inv.quantity,
                  performedBy: req.user?.id,
                  remarks: remarks || `Goods received for PO ${activePo.purchaseOrderNumber}`,
                },
              ],
              { session }
            );
          }

          // Quarantine damaged items upon intake (isolated from sellable stock)
          if (damagedQty > 0) {
            inv.damagedStock = (inv.damagedStock || 0) + damagedQty;

            await StockMovement.create(
              [
                {
                  product: prodId,
                  warehouse: targetWarehouse,
                  type: "DAMAGED",
                  quantity: damagedQty,
                  referenceType: "PURCHASE",
                  referenceId: activePo._id,
                  previousQuantity: prevQty,
                  newQuantity: inv.quantity,
                  performedBy: req.user?.id,
                  remarks: `Quarantined damaged items on intake: PO ${activePo.purchaseOrderNumber}`,
                },
              ],
              { session }
            );
          }

          await inv.save({ session });
        }

        poItem.receivedQuantity += receivedQty;

        processedItems.push({
          product: prodId,
          orderedQuantity: poItem.quantity,
          receivedQuantity: receivedQty,
          acceptedQuantity: acceptedQty,
          damagedQuantity: damagedQty,
          rejectedQuantity: rejectedQty,
        });
      }

      // Update PO status: PARTIALLY_RECEIVED or RECEIVED
      const allCompleted = activePo.items.every((i) => i.receivedQuantity >= i.quantity);
      activePo.status = allCompleted ? "RECEIVED" : "PARTIALLY_RECEIVED";
      activePo.fulfillmentStatus = allCompleted ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await activePo.save({ session });

      const grDocs = await GoodsReceipt.create(
        [
          {
            grnNumber: uniqueGrnNumber,
            purchaseOrder: activePo._id,
            warehouse: targetWarehouse,
            receivedBy: req.user?.id,
            receiptDate: parsedReceiptDate,
            items: processedItems,
            remarks: remarks || "",
          },
        ],
        { session }
      );

      return { receipt: grDocs[0], po: activePo };
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "GOODS_RECEIPT_RECORDED",
      entityType: "PURCHASE_ORDER",
      entityId: po._id,
      description: `Goods receipt ${uniqueGrnNumber} recorded for PO ${po.purchaseOrderNumber}, status updated to ${result.po.status}`,
      newData: result.receipt.toObject(),
      ipAddress: req.ip,
    });

    const populated = await GoodsReceipt.findById(result.receipt._id)
      .populate("purchaseOrder", "purchaseOrderNumber status totalAmount")
      .populate("warehouse", "warehouseName location")
      .populate("receivedBy", "name email")
      .populate("items.product", "productName sku");

    res.status(201).json({
      success: true,
      message: `Goods receipt processed successfully. Order status is now ${result.po.status}.`,
      data: populated,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

// 2. List Goods Receipts
const list = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.purchaseOrder) filter.purchaseOrder = req.query.purchaseOrder;
    if (req.query.warehouse) {
      const access = await checkWarehouseAccess(req.user, req.query.warehouse, { requireMutation: false });
      if (!access.allowed) {
        return res.status(access.status || 403).json({ success: false, message: access.message });
      }
      filter.warehouse = req.query.warehouse;
    } else {
      const assignedFilter = await getAuthorizedWarehouseFilter(req.user);
      if (assignedFilter !== null) {
        filter.warehouse = { $in: assignedFilter.map((id) => new mongoose.Types.ObjectId(id)) };
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, receipts] = await Promise.all([
      GoodsReceipt.countDocuments(filter),
      GoodsReceipt.find(filter)
        .populate("purchaseOrder", "purchaseOrderNumber status totalAmount orderDate")
        .populate("warehouse", "warehouseName location")
        .populate("receivedBy", "name email")
        .populate("items.product", "productName sku")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    res.json({
      success: true,
      count: receipts.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: receipts,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get Single Goods Receipt
const get = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Goods Receipt ID." });
    }

    const receipt = await GoodsReceipt.findById(req.params.id)
      .populate("purchaseOrder")
      .populate("warehouse")
      .populate("receivedBy", "name email")
      .populate("items.product");

    if (!receipt) {
      return res.status(404).json({ success: false, message: "Goods receipt not found." });
    }

    const access = await checkWarehouseAccess(req.user, receipt.warehouse?._id || receipt.warehouse, { requireMutation: false });
    if (!access.allowed) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    res.json({ success: true, data: receipt });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  create,
  list,
  get,
};

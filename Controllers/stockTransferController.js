const mongoose = require("mongoose");
const StockTransfer = require("../Models/StockTransfer");
const Inventory = require("../Models/Inventory");
const StockMovement = require("../Models/StockMovement");
const Warehouse = require("../Models/Warehouse");
const Product = require("../Models/Product");
const { runInTransaction } = require("../Utils/dbTransactions");
const { logAudit } = require("../Utils/auditLogger");
const { validId } = require("../Utils/crudController");
const {
  checkWarehouseAccess,
  getAuthorizedWarehouseFilter,
} = require("../Middleware/warehouseAuthMiddleware");

/**
 * 1. Create Stock Transfer Request
 */
const create = async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.sourceWarehouse || !b.destinationWarehouse || !b.items?.length) {
      return res.status(400).json({
        success: false,
        message: "sourceWarehouse, destinationWarehouse and items are required",
      });
    }

    if (!validId(b.sourceWarehouse) || !validId(b.destinationWarehouse)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sourceWarehouse or destinationWarehouse ID.",
      });
    }

    if (String(b.sourceWarehouse) === String(b.destinationWarehouse)) {
      return res.status(400).json({
        success: false,
        message: "Source and destination warehouses must differ",
      });
    }

    // Authorization: User must have authorized access to either source or destination warehouse
    const srcAccess = await checkWarehouseAccess(req.user, b.sourceWarehouse, { requireMutation: false });
    const dstAccess = await checkWarehouseAccess(req.user, b.destinationWarehouse, { requireMutation: false });
    if (!srcAccess.allowed && !dstAccess.allowed) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not assigned to either the source or destination warehouse of this transfer.",
      });
    }

    const [srcWh, dstWh] = await Promise.all([
      Warehouse.findById(b.sourceWarehouse),
      Warehouse.findById(b.destinationWarehouse),
    ]);

    if (!srcWh || !dstWh) {
      return res.status(404).json({ success: false, message: "Warehouse not found" });
    }

    if (srcWh.status === "INACTIVE" || dstWh.status === "INACTIVE") {
      return res.status(400).json({
        success: false,
        message: "Cannot create transfer involving an INACTIVE warehouse",
      });
    }

    for (const i of b.items) {
      if (!validId(i.product)) {
        return res.status(400).json({ success: false, message: `Invalid Product ID: ${i.product}` });
      }
      const p = await Product.findById(i.product);
      if (!p) {
        return res.status(404).json({ success: false, message: `Product ${i.product} not found` });
      }
      if (!i.quantity || i.quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be greater than zero",
        });
      }
    }

    let parsedTransferDate = new Date();
    if (b.transferDate) {
      const td = new Date(b.transferDate);
      if (isNaN(td.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid transferDate format." });
      }
      if (td > new Date()) {
        return res.status(400).json({ success: false, message: "Transfer date cannot be in the future." });
      }
      parsedTransferDate = td;
    }

    let parsedExpectedArrival = undefined;
    if (b.expectedArrivalDate) {
      const ea = new Date(b.expectedArrivalDate);
      if (isNaN(ea.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid expectedArrivalDate format." });
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (ea < todayStart) {
        return res.status(400).json({ success: false, message: "Expected arrival date cannot be in the past." });
      }
      parsedExpectedArrival = ea;
    }

    const d = await StockTransfer.create({
      sourceWarehouse: b.sourceWarehouse,
      destinationWarehouse: b.destinationWarehouse,
      requestedBy: req.user?.id,
      items: b.items,
      transferDate: parsedTransferDate,
      expectedArrivalDate: parsedExpectedArrival,
      status: "REQUESTED",
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "STOCK_TRANSFER_REQUESTED",
      entityType: "STOCK_TRANSFER",
      entityId: d._id,
      description: `Stock transfer requested from ${srcWh.warehouseName} to ${dstWh.warehouseName}`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    const populated = await StockTransfer.findById(d._id)
      .populate("sourceWarehouse destinationWarehouse requestedBy approvedBy")
      .populate("items.product", "productName sku");

    res.status(201).json({ success: true, data: populated });
  } catch (e) {
    next(e);
  }
};

/**
 * 2. List Stock Transfers
 */
const list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) q.status = req.query.status.toUpperCase();

    // Scoped visibility: Warehouse Managers only see transfers involving their assigned/managed warehouses
    const assignedFilter = await getAuthorizedWarehouseFilter(req.user);
    if (assignedFilter !== null) {
      const oids = assignedFilter.map((id) => new mongoose.Types.ObjectId(id));
      if (req.query.sourceWarehouse && req.query.destinationWarehouse) {
        const canSrc = assignedFilter.includes(String(req.query.sourceWarehouse));
        const canDst = assignedFilter.includes(String(req.query.destinationWarehouse));
        if (!canSrc && !canDst) {
          return res.json({ success: true, count: 0, data: [] });
        }
        q.sourceWarehouse = req.query.sourceWarehouse;
        q.destinationWarehouse = req.query.destinationWarehouse;
      } else if (req.query.sourceWarehouse) {
        if (!assignedFilter.includes(String(req.query.sourceWarehouse))) {
          q.sourceWarehouse = req.query.sourceWarehouse;
          q.destinationWarehouse = { $in: oids };
        } else {
          q.sourceWarehouse = req.query.sourceWarehouse;
        }
      } else if (req.query.destinationWarehouse) {
        if (!assignedFilter.includes(String(req.query.destinationWarehouse))) {
          q.destinationWarehouse = req.query.destinationWarehouse;
          q.sourceWarehouse = { $in: oids };
        } else {
          q.destinationWarehouse = req.query.destinationWarehouse;
        }
      } else {
        q.$or = [{ sourceWarehouse: { $in: oids } }, { destinationWarehouse: { $in: oids } }];
      }
    } else {
      if (req.query.sourceWarehouse) q.sourceWarehouse = req.query.sourceWarehouse;
      if (req.query.destinationWarehouse) q.destinationWarehouse = req.query.destinationWarehouse;
    }

    const d = await StockTransfer.find(q)
      .populate("sourceWarehouse destinationWarehouse requestedBy approvedBy")
      .populate("items.product", "productName sku")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: d.length, data: d });
  } catch (e) {
    next(e);
  }
};

/**
 * 3. Get Single Stock Transfer
 */
const get = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Stock Transfer ID." });
    }

    const d = await StockTransfer.findById(req.params.id)
      .populate("sourceWarehouse destinationWarehouse requestedBy approvedBy")
      .populate("items.product");
    if (!d) return res.status(404).json({ success: false, message: "Transfer not found" });

    // Authorization: User must have access to either source or destination warehouse
    const srcAccess = await checkWarehouseAccess(req.user, d.sourceWarehouse?._id || d.sourceWarehouse, { requireMutation: false });
    const dstAccess = await checkWarehouseAccess(req.user, d.destinationWarehouse?._id || d.destinationWarehouse, { requireMutation: false });
    if (!srcAccess.allowed && !dstAccess.allowed) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view transfers for these warehouses.",
      });
    }

    res.json({ success: true, data: d });
  } catch (e) {
    next(e);
  }
};

/**
 * 4. Approve Stock Transfer (Source Warehouse Authority)
 */
const approve = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Transfer ID." });
    }

    const d = await StockTransfer.findById(req.params.id);
    if (!d) return res.status(404).json({ success: false, message: "Transfer not found" });
    if (d.status !== "REQUESTED") {
      return res.status(400).json({
        success: false,
        message: "Only requested transfers can be approved",
      });
    }

    // Verify user has authority over the source warehouse
    const srcAccess = await checkWarehouseAccess(req.user, d.sourceWarehouse, { requireMutation: true });
    if (!srcAccess.allowed) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only an authorized manager of the source warehouse or an Administrator can approve this transfer.",
      });
    }

    // Verify source stock availability
    for (const i of d.items) {
      const inv = await Inventory.findOne({
        product: i.product,
        warehouse: d.sourceWarehouse,
      });
      const available = inv ? inv.quantity - (inv.reservedStock || 0) : 0;
      if (available < i.quantity) {
        return res.status(409).json({
          success: false,
          message: `Insufficient source stock for product ${i.product}. Available: ${available}, required: ${i.quantity}`,
        });
      }
    }

    d.status = "APPROVED";
    d.approvedBy = req.user?.id;
    await d.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "STOCK_TRANSFER_APPROVED",
      entityType: "STOCK_TRANSFER",
      entityId: d._id,
      description: `Stock transfer ${d._id} approved`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    res.json({ success: true, message: "Transfer approved successfully.", data: d });
  } catch (e) {
    next(e);
  }
};

/**
 * 5. Dispatch Stock Transfer (Source Warehouse Authority -> IN_TRANSIT)
 */
const dispatch = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Transfer ID." });
    }

    const d = await StockTransfer.findById(req.params.id);
    if (!d) return res.status(404).json({ success: false, message: "Transfer not found" });
    if (d.status !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: "Only approved transfers can be dispatched",
      });
    }

    // Verify user has authority over source warehouse
    const srcAccess = await checkWarehouseAccess(req.user, d.sourceWarehouse, { requireMutation: true });
    if (!srcAccess.allowed) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only an authorized manager of the source warehouse or an Administrator can dispatch this transfer.",
      });
    }

    d.status = "IN_TRANSIT";
    await d.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "STOCK_TRANSFER_DISPATCHED",
      entityType: "STOCK_TRANSFER",
      entityId: d._id,
      description: `Stock transfer ${d._id} dispatched (IN_TRANSIT)`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    res.json({ success: true, message: "Transfer dispatched (IN_TRANSIT).", data: d });
  } catch (e) {
    next(e);
  }
};

/**
 * 6. Complete Stock Transfer (Destination Warehouse Authority -> COMPLETED)
 * Decrements source inventory, increments destination inventory atomically,
 * creates TRANSFER_OUT and TRANSFER_IN stock movements.
 */
const complete = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Transfer ID." });
    }

    const d = await StockTransfer.findById(req.params.id);
    if (!d) return res.status(404).json({ success: false, message: "Transfer not found" });
    if (!["APPROVED", "IN_TRANSIT"].includes(d.status)) {
      return res.status(400).json({
        success: false,
        message: "Transfer is not ready for completion (must be APPROVED or IN_TRANSIT)",
      });
    }

    // Verify user has authority over destination warehouse
    const dstAccess = await checkWarehouseAccess(req.user, d.destinationWarehouse, { requireMutation: true });
    if (!dstAccess.allowed) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only an authorized manager of the destination warehouse or an Administrator can accept and complete this transfer.",
      });
    }

    await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      for (const i of d.items) {
        let srcQuery = Inventory.findOne({
          product: i.product,
          warehouse: d.sourceWarehouse,
        });
        if (session) srcQuery = srcQuery.session(session);
        const src = await srcQuery;

        const available = src ? src.quantity - (src.reservedStock || 0) : 0;
        if (!src || available < i.quantity) {
          const err = new Error(`Insufficient source stock for product ${i.product}. Available: ${available}, required: ${i.quantity}`);
          err.statusCode = 409;
          throw err;
        }

        const srcPrev = src.quantity;
        src.quantity -= i.quantity;
        await src.save(opts);

        let dstQuery = Inventory.findOne({
          product: i.product,
          warehouse: d.destinationWarehouse,
        });
        if (session) dstQuery = dstQuery.session(session);
        let dst = await dstQuery;

        if (!dst) {
          if (session) {
            const created = await Inventory.create(
              [{ product: i.product, warehouse: d.destinationWarehouse, quantity: 0, reservedStock: 0 }],
              { session }
            );
            dst = created[0];
          } else {
            dst = await Inventory.create({
              product: i.product,
              warehouse: d.destinationWarehouse,
              quantity: 0,
              reservedStock: 0,
            });
          }
        }

        const dstPrev = dst.quantity;
        dst.quantity += i.quantity;
        await dst.save(opts);

        const moveOutData = {
          product: i.product,
          warehouse: d.sourceWarehouse,
          type: "TRANSFER_OUT",
          quantity: i.quantity,
          referenceType: "TRANSFER",
          referenceId: d._id,
          previousQuantity: srcPrev,
          newQuantity: src.quantity,
          performedBy: req.user?.id,
        };

        const moveInData = {
          product: i.product,
          warehouse: d.destinationWarehouse,
          type: "TRANSFER_IN",
          quantity: i.quantity,
          referenceType: "TRANSFER",
          referenceId: d._id,
          previousQuantity: dstPrev,
          newQuantity: dst.quantity,
          performedBy: req.user?.id,
        };

        if (session) {
          await StockMovement.create([moveOutData], { session });
          await StockMovement.create([moveInData], { session });
        } else {
          await StockMovement.create(moveOutData);
          await StockMovement.create(moveInData);
        }

        i.receivedQuantity = i.quantity;
      }

      d.status = "COMPLETED";
      d.completedAt = new Date();
      await d.save(opts);

      await logAudit({
        employeeId: req.user?.id,
        action: "STOCK_TRANSFER_COMPLETED",
        entityType: "STOCK_TRANSFER",
        entityId: d._id,
        description: `Stock transfer ${d._id} completed`,
        newData: d.toObject(),
        ipAddress: req.ip,
      });
    });

    const populated = await StockTransfer.findById(d._id)
      .populate("sourceWarehouse destinationWarehouse requestedBy approvedBy")
      .populate("items.product");

    res.json({ success: true, message: "Transfer completed successfully", data: populated });
  } catch (e) {
    if (e.statusCode) {
      return res.status(e.statusCode).json({ success: false, message: e.message });
    }
    next(e);
  }
};

/**
 * 7. Reject Stock Transfer
 */
const reject = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Transfer ID." });
    }

    const { reason } = req.body;
    const d = await StockTransfer.findById(req.params.id);
    if (!d) return res.status(404).json({ success: false, message: "Transfer not found" });
    if (!["REQUESTED", "APPROVED"].includes(d.status)) {
      return res.status(400).json({
        success: false,
        message: "Only requested or approved transfers can be rejected",
      });
    }

    const srcAccess = await checkWarehouseAccess(req.user, d.sourceWarehouse, { requireMutation: true });
    const dstAccess = await checkWarehouseAccess(req.user, d.destinationWarehouse, { requireMutation: true });
    if (!srcAccess.allowed && !dstAccess.allowed) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to reject this transfer.",
      });
    }

    d.status = "REJECTED";
    await d.save();

    await logAudit({
      employeeId: req.user?.id,
      action: "STOCK_TRANSFER_REJECTED",
      entityType: "STOCK_TRANSFER",
      entityId: d._id,
      description: `Stock transfer ${d._id} rejected: ${reason || "No reason given"}`,
      newData: d.toObject(),
      ipAddress: req.ip,
    });

    res.json({ success: true, message: "Stock transfer rejected.", data: d });
  } catch (e) {
    next(e);
  }
};

module.exports = {
  create,
  list,
  get,
  approve,
  dispatch,
  complete,
  reject,
};

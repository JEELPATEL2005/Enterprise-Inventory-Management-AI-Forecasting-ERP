const mongoose = require("mongoose");
const Warehouse = require("../Models/Warehouse");
const Employee = require("../Models/Employee");
const Inventory = require("../Models/Inventory");
const StockTransfer = require("../Models/StockTransfer");
const PurchaseOrder = require("../Models/PurchaseOrder");
const SalesOrder = require("../Models/SalesOrder");
const { validId } = require("../Utils/crudController");
const { logAudit } = require("../Utils/auditLogger");
const { normalizeRole, ROLES } = require("../Middleware/roleMiddleware");
const { getAuthorizedWarehouseFilter, checkWarehouseAccess } = require("../Middleware/warehouseAuthMiddleware");

/**
 * 1. List Warehouses
 * Supports search, status filtering, and assigned-only filtering
 */
const list = async (req, res, next) => {
  try {
    const q = {};
    if (req.query.status) {
      q.status = req.query.status.toUpperCase();
    }
    if (req.query.search) {
      q.$or = [
        { warehouseName: { $regex: req.query.search, $options: "i" } },
        { location: { $regex: req.query.search, $options: "i" } },
      ];
    }

    const userRole = normalizeRole(req.user?.roleName);
    const assignedFilter = await getAuthorizedWarehouseFilter(req.user);

    // Warehouse Managers can only view their assigned or managed warehouses
    // (allowAllActive=true allows selecting external destination warehouses for transfer requests)
    if (userRole === ROLES.WAREHOUSE_MANAGER && req.query.allowAllActive !== "true") {
      const oids = (assignedFilter || []).map((id) => new mongoose.Types.ObjectId(id));
      q._id = { $in: oids };
    } else if (req.query.assignedOnly === "true" && assignedFilter !== null) {
      q._id = { $in: assignedFilter.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    const docs = await Warehouse.find(q)
      .populate("primaryManager", "name email phone department status")
      .sort({ warehouseName: 1 });

    // Augment with role-based access flag and current inventory summary
    const enhancedDocs = await Promise.all(
      docs.map(async (doc) => {
        const obj = doc.toObject();
        if (assignedFilter === null) {
          obj.isAssigned = true;
        } else {
          obj.isAssigned = assignedFilter.includes(String(doc._id));
        }

        // Live inventory metric summary
        const invSummary = await Inventory.aggregate([
          { $match: { warehouse: doc._id } },
          {
            $group: {
              _id: "$warehouse",
              totalUnits: { $sum: "$quantity" },
              skuCount: { $sum: 1 },
            },
          },
        ]);

        const currentStock = invSummary[0]?.totalUnits || 0;
        obj.currentStock = currentStock;
        obj.skuCount = invSummary[0]?.skuCount || 0;
        obj.capacityUtilization = doc.capacity > 0 ? Number(((currentStock / doc.capacity) * 100).toFixed(1)) : 0;

        return obj;
      })
    );

    res.json({
      success: true,
      count: enhancedDocs.length,
      data: enhancedDocs,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 2. Get Single Warehouse by ID
 */
const get = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Warehouse ID." });
    }

    const access = await checkWarehouseAccess(req.user, req.params.id, { requireMutation: false });
    if (!access.allowed) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const doc = await Warehouse.findById(req.params.id).populate(
      "primaryManager",
      "name email phone department status"
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }

    const invSummary = await Inventory.aggregate([
      { $match: { warehouse: doc._id } },
      {
        $group: {
          _id: "$warehouse",
          totalQuantity: { $sum: "$quantity" },
          totalReserved: { $sum: "$reservedStock" },
          totalDamaged: { $sum: "$damagedStock" },
          skuCount: { $sum: 1 },
        },
      },
    ]);

    const totalStock = invSummary[0]?.totalQuantity || 0;
    const reservedStock = invSummary[0]?.totalReserved || 0;
    const damagedStock = invSummary[0]?.totalDamaged || 0;
    const availableStock = Math.max(0, totalStock - reservedStock);

    const data = doc.toObject();
    data.currentStock = totalStock;
    data.reservedStock = reservedStock;
    data.damagedStock = damagedStock;
    data.availableStock = availableStock;
    data.skuCount = invSummary[0]?.skuCount || 0;
    data.capacityUtilization = doc.capacity > 0 ? Number(((totalStock / doc.capacity) * 100).toFixed(1)) : 0;

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

/**
 * 3. Create Warehouse (Admin Only)
 */
const create = async (req, res, next) => {
  try {
    const { warehouseName, location, capacity, primaryManager, status } = req.body;

    if (!warehouseName || !location || capacity === undefined) {
      return res.status(400).json({
        success: false,
        message: "warehouseName, location, and capacity are required.",
      });
    }

    const capNum = Number(capacity);
    if (isNaN(capNum) || capNum < 0) {
      return res.status(400).json({
        success: false,
        message: "Capacity must be a non-negative number.",
      });
    }

    // Check duplicate name
    const existing = await Warehouse.findOne({
      warehouseName: { $regex: new RegExp(`^${warehouseName.trim()}$`, "i") },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `A warehouse with name '${warehouseName.trim()}' already exists.`,
      });
    }

    let managerId = null;
    if (primaryManager) {
      if (!validId(primaryManager)) {
        return res.status(400).json({ success: false, message: "Invalid primaryManager Employee ID." });
      }
      const emp = await Employee.findById(primaryManager);
      if (!emp) {
        return res.status(404).json({ success: false, message: "Designated Warehouse Manager not found." });
      }
      managerId = emp._id;
    }

    const doc = await Warehouse.create({
      warehouseName: warehouseName.trim(),
      location: location.trim(),
      capacity: capNum,
      primaryManager: managerId,
      status: status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    });

    // If manager assigned, add this warehouse to manager's assignedWarehouses
    if (managerId) {
      await Employee.findByIdAndUpdate(managerId, {
        $addToSet: { assignedWarehouses: doc._id },
      });
    }

    await logAudit({
      employeeId: req.user?.id,
      action: "WAREHOUSE_CREATED",
      entityType: "WAREHOUSE",
      entityId: doc._id,
      description: `Warehouse '${doc.warehouseName}' registered with capacity ${doc.capacity}`,
      newData: doc.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Warehouse.findById(doc._id).populate(
      "primaryManager",
      "name email phone department"
    );

    res.status(201).json({
      success: true,
      message: "Warehouse created successfully.",
      data: populated,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 4. Update Warehouse (Admin Only)
 * Supports renaming, location change, capacity updates, and status toggle
 */
const update = async (req, res, next) => {
  try {
    if (!validId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid Warehouse ID." });
    }

    const existing = await Warehouse.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }

    const { warehouseName, location, capacity, primaryManager, status } = req.body;
    const oldManager = existing.primaryManager;

    if (warehouseName && warehouseName.trim() !== existing.warehouseName) {
      const duplicate = await Warehouse.findOne({
        _id: { $ne: existing._id },
        warehouseName: { $regex: new RegExp(`^${warehouseName.trim()}$`, "i") },
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: `A warehouse with name '${warehouseName.trim()}' already exists.`,
        });
      }
      existing.warehouseName = warehouseName.trim();
    }

    if (location) existing.location = location.trim();
    if (capacity !== undefined) {
      const capNum = Number(capacity);
      if (isNaN(capNum) || capNum < 0) {
        return res.status(400).json({ success: false, message: "Capacity must be non-negative." });
      }
      existing.capacity = capNum;
    }
    if (status && ["ACTIVE", "INACTIVE"].includes(status.toUpperCase())) {
      existing.status = status.toUpperCase();
    }

    // Manager reassignment
    let managerChanged = false;
    if (primaryManager !== undefined) {
      if (primaryManager === null || primaryManager === "") {
        existing.primaryManager = null;
        managerChanged = true;
      } else {
        if (!validId(primaryManager)) {
          return res.status(400).json({ success: false, message: "Invalid primaryManager Employee ID." });
        }
        const emp = await Employee.findById(primaryManager);
        if (!emp) {
          return res.status(404).json({ success: false, message: "Manager employee not found." });
        }
        existing.primaryManager = emp._id;
        managerChanged = true;
      }
    }

    await existing.save();

    // Sync Employee.assignedWarehouses
    if (managerChanged) {
      if (oldManager && (!existing.primaryManager || String(oldManager) !== String(existing.primaryManager))) {
        // Remove warehouse from old manager's assignments
        await Employee.findByIdAndUpdate(oldManager, {
          $pull: { assignedWarehouses: existing._id },
        });
      }
      if (existing.primaryManager) {
        // Add warehouse to new manager's assignments
        await Employee.findByIdAndUpdate(existing.primaryManager, {
          $addToSet: { assignedWarehouses: existing._id },
        });
      }
    }

    await logAudit({
      employeeId: req.user?.id,
      action: "WAREHOUSE_UPDATED",
      entityType: "WAREHOUSE",
      entityId: existing._id,
      description: `Warehouse '${existing.warehouseName}' details updated`,
      newData: existing.toObject(),
      ipAddress: req.ip,
    });

    const populated = await Warehouse.findById(existing._id).populate(
      "primaryManager",
      "name email phone department"
    );

    res.json({
      success: true,
      message: "Warehouse updated successfully.",
      data: populated,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 5. Assign / Reassign Warehouse Manager (Admin Only)
 */
const assignManager = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { managerId } = req.body;

    if (!validId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Warehouse ID." });
    }

    const wh = await Warehouse.findById(id);
    if (!wh) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }

    const oldManager = wh.primaryManager;

    if (!managerId) {
      // Unassign manager
      wh.primaryManager = null;
      await wh.save();

      if (oldManager) {
        await Employee.findByIdAndUpdate(oldManager, {
          $pull: { assignedWarehouses: wh._id },
        });
      }

      await logAudit({
        employeeId: req.user?.id,
        action: "WAREHOUSE_MANAGER_UNASSIGNED",
        entityType: "WAREHOUSE",
        entityId: wh._id,
        description: `Warehouse manager unassigned from ${wh.warehouseName}`,
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        message: "Warehouse manager unassigned successfully.",
        data: wh,
      });
    }

    if (!validId(managerId)) {
      return res.status(400).json({ success: false, message: "Invalid Manager ID." });
    }

    const manager = await Employee.findById(managerId).populate("role");
    if (!manager || manager.status !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        message: "Active Warehouse Manager employee not found.",
      });
    }

    wh.primaryManager = manager._id;
    await wh.save();

    // Clean up old manager's array
    if (oldManager && String(oldManager) !== String(manager._id)) {
      await Employee.findByIdAndUpdate(oldManager, {
        $pull: { assignedWarehouses: wh._id },
      });
    }

    // Add to new manager's assigned warehouses
    await Employee.findByIdAndUpdate(manager._id, {
      $addToSet: { assignedWarehouses: wh._id },
    });

    await logAudit({
      employeeId: req.user?.id,
      action: "WAREHOUSE_MANAGER_ASSIGNED",
      entityType: "WAREHOUSE",
      entityId: wh._id,
      description: `Manager ${manager.name} assigned to warehouse ${wh.warehouseName}`,
      ipAddress: req.ip,
    });

    const populated = await Warehouse.findById(wh._id).populate(
      "primaryManager",
      "name email phone department"
    );

    res.json({
      success: true,
      message: `Warehouse Manager ${manager.name} successfully assigned to ${wh.warehouseName}.`,
      data: populated,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 6. Warehouse Performance & Utilization Analytics
 */
const getPerformance = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!validId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Warehouse ID." });
    }

    const access = await checkWarehouseAccess(req.user, id, { requireMutation: false });
    if (!access.allowed) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const wh = await Warehouse.findById(id).populate(
      "primaryManager",
      "name email phone department"
    );
    if (!wh) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }

    const whId = new mongoose.Types.ObjectId(id);

    // Aggregate inventory metrics & valuation
    const [invData, pendingPOs, inTransitTransfers, pendingDispatches] = await Promise.all([
      Inventory.aggregate([
        { $match: { warehouse: whId } },
        {
          $lookup: {
            from: "products",
            localField: "product",
            foreignField: "_id",
            as: "productDoc",
          },
        },
        { $unwind: "$productDoc" },
        {
          $project: {
            quantity: 1,
            reservedStock: 1,
            damagedStock: 1,
            reorderPoint: 1,
            costPrice: "$productDoc.costPrice",
            unitPrice: "$productDoc.unitPrice",
            productName: "$productDoc.productName",
            sku: "$productDoc.sku",
            valuation: { $multiply: ["$quantity", { $ifNull: ["$productDoc.costPrice", 0] }] },
          },
        },
      ]),
      // Purchase orders delivering to this warehouse
      PurchaseOrder.countDocuments({
        warehouse: whId,
        status: { $in: ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] },
      }),
      // Inter-warehouse transfers involving this warehouse
      StockTransfer.countDocuments({
        $or: [{ sourceWarehouse: whId }, { destinationWarehouse: whId }],
        status: { $in: ["REQUESTED", "APPROVED", "IN_TRANSIT"] },
      }),
      // Sales order dispatches pending from this warehouse
      SalesOrder.countDocuments({
        warehouse: whId,
        status: { $in: ["RESERVED", "PROCESSING", "CONFIRMED"] },
      }),
    ]);

    let totalQuantity = 0;
    let totalReserved = 0;
    let totalDamaged = 0;
    let totalValuation = 0;
    let lowStockCount = 0;

    for (const item of invData) {
      totalQuantity += item.quantity || 0;
      totalReserved += item.reservedStock || 0;
      totalDamaged += item.damagedStock || 0;
      totalValuation += item.valuation || 0;
      const available = (item.quantity || 0) - (item.reservedStock || 0);
      if (available <= (item.reorderPoint || 10)) {
        lowStockCount++;
      }
    }

    const availableStock = Math.max(0, totalQuantity - totalReserved);
    const capacity = wh.capacity || 10000;
    const capacityUtilization = capacity > 0 ? Number(((totalQuantity / capacity) * 100).toFixed(2)) : 0;

    res.json({
      success: true,
      warehouse: {
        id: wh._id,
        name: wh.warehouseName,
        location: wh.location,
        capacity: wh.capacity,
        status: wh.status,
        manager: wh.primaryManager,
      },
      metrics: {
        capacityUtilization,
        totalQuantity,
        availableStock,
        reservedStock: totalReserved,
        damagedStock: totalDamaged,
        skuCount: invData.length,
        totalValuation,
        lowStockSkuCount: lowStockCount,
      },
      operations: {
        incomingDeliveriesPending: pendingPOs,
        activeStockTransfers: inTransitTransfers,
        pendingSalesDispatches: pendingDispatches,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * 7. Remove / Decommission Warehouse (Admin Only)
 * Guard: Blocks deletion if physical stock is still present (> 0 units)
 */
const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!validId(id)) {
      return res.status(400).json({ success: false, message: "Invalid Warehouse ID." });
    }

    const wh = await Warehouse.findById(id);
    if (!wh) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }

    // Safety check: ensure no active physical stock
    const activeInventory = await Inventory.findOne({
      warehouse: wh._id,
      quantity: { $gt: 0 },
    });

    if (activeInventory) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete warehouse '${wh.warehouseName}' because it currently holds inventory. Please transfer or adjust all stock to 0 or deactivate the warehouse instead.`,
      });
    }

    // Unassign from manager if assigned
    if (wh.primaryManager) {
      await Employee.findByIdAndUpdate(wh.primaryManager, {
        $pull: { assignedWarehouses: wh._id },
      });
    }

    await Warehouse.findByIdAndDelete(wh._id);

    await logAudit({
      employeeId: req.user?.id,
      action: "WAREHOUSE_DELETED",
      entityType: "WAREHOUSE",
      entityId: wh._id,
      description: `Warehouse '${wh.warehouseName}' permanently removed`,
      oldData: wh.toObject(),
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: `Warehouse '${wh.warehouseName}' has been decommissioned and removed.`,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  assignManager,
  getPerformance,
  remove,
};

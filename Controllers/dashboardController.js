const mongoose = require("mongoose");
const Product = require("../Models/Product");
const Warehouse = require("../Models/Warehouse");
const Vendor = require("../Models/Vendor");
const Customer = require("../Models/Customer");
const Employee = require("../Models/Employee");
const PurchaseOrder = require("../Models/PurchaseOrder");
const PurchaseRequest = require("../Models/PurchaseRequest");
const GoodsReceipt = require("../Models/GoodsReceipt");
const SalesOrder = require("../Models/SalesOrder");
const Invoice = require("../Models/Invoice");
const Delivery = require("../Models/Delivery");
const Return = require("../Models/Return");
const Inventory = require("../Models/Inventory");
const StockMovement = require("../Models/StockMovement");
const StockTransfer = require("../Models/StockTransfer");
const AuditLog = require("../Models/AuditLog");
const { normalizeRole, ROLES } = require("../Middleware/roleMiddleware");
const { getAuthorizedWarehouseFilter, checkWarehouseAccess } = require("../Middleware/warehouseAuthMiddleware");
const { validId } = require("../Utils/crudController");

const getDashboard = async (req, res, next) => {
  try {
    const userRole = normalizeRole(req.user?.roleName);
    const assignedFilter = await getAuthorizedWarehouseFilter(req.user);

    // Common Low-stock calculation helper
    const getLowStockItems = async (whFilter = null) => {
      const q = {};
      if (whFilter) {
        if (Array.isArray(whFilter)) {
          q.warehouse = { $in: whFilter.map((id) => new mongoose.Types.ObjectId(id)) };
        } else {
          q.warehouse = whFilter;
        }
      }
      const invList = await Inventory.find(q)
        .populate("product", "productName sku costPrice unitPrice averageDailyDemand leadTimeDays safetyStock reorderPoint")
        .populate("warehouse", "warehouseName location");

      return invList
        .filter((i) => {
          if (!i.product) return false;
          const reorder = i.product.reorderPoint !== undefined && i.product.reorderPoint !== null
            ? i.product.reorderPoint
            : (i.product.averageDailyDemand || 0) * (i.product.leadTimeDays || 0) + (i.product.safetyStock || 0);
          const available = i.quantity - (i.reservedStock || 0);
          return available <= reorder;
        })
        .map((i) => {
          const reorder = i.product.reorderPoint !== undefined && i.product.reorderPoint !== null
            ? i.product.reorderPoint
            : (i.product.averageDailyDemand || 0) * (i.product.leadTimeDays || 0) + (i.product.safetyStock || 0);
          return {
            product: i.product.productName,
            sku: i.product.sku,
            warehouse: i.warehouse?.warehouseName,
            warehouseId: i.warehouse?._id,
            quantity: i.quantity,
            reservedStock: i.reservedStock || 0,
            availableStock: i.quantity - (i.reservedStock || 0),
            reorderPoint: reorder,
          };
        });
    };

    // Helper: Build Comparative Multi-Warehouse Matrix
    const getMultiWarehouseMatrix = async (whFilter = null) => {
      const q = { status: "ACTIVE" };
      if (whFilter) {
        if (Array.isArray(whFilter)) {
          q._id = { $in: whFilter.map((id) => new mongoose.Types.ObjectId(id)) };
        } else {
          q._id = whFilter;
        }
      }
      const allWh = await Warehouse.find(q)
        .populate("primaryManager", "name email phone")
        .sort({ warehouseName: 1 });

      return await Promise.all(
        allWh.map(async (wh) => {
          const invData = await Inventory.aggregate([
            { $match: { warehouse: wh._id } },
            {
              $lookup: {
                from: "products",
                localField: "product",
                foreignField: "_id",
                as: "p",
              },
            },
            {
              $group: {
                _id: "$warehouse",
                totalStock: { $sum: "$quantity" },
                reservedStock: { $sum: "$reservedStock" },
                damagedStock: { $sum: "$damagedStock" },
                skuCount: { $sum: 1 },
              },
            },
          ]);

          const totalStock = invData[0]?.totalStock || 0;
          const reservedStock = invData[0]?.reservedStock || 0;
          const damagedStock = invData[0]?.damagedStock || 0;
          const capacity = wh.capacity || 10000;
          const capacityUtilization = capacity > 0 ? Number(((totalStock / capacity) * 100).toFixed(1)) : 0;

          return {
            warehouseId: wh._id,
            warehouseName: wh.warehouseName,
            location: wh.location,
            capacity: wh.capacity,
            manager: wh.primaryManager?.name || "Unassigned",
            managerEmail: wh.primaryManager?.email || "",
            totalStock,
            availableStock: Math.max(0, totalStock - reservedStock),
            reservedStock,
            damagedStock,
            skuCount: invData[0]?.skuCount || 0,
            capacityUtilization,
          };
        })
      );
    };

    // 1. PURCHASE MANAGER DASHBOARD
    if (userRole === ROLES.PURCHASE_MANAGER) {
      const [
        pendingPRs,
        approvedPRsCount,
        allPOs,
        pendingReceivingPOs,
        overduePOs,
        vendorCount,
        topVendors,
        monthlyTrends,
        vendorAcceptancePendingCount,
        vendorAcceptedCount,
        vendorRejectedCount,
      ] = await Promise.all([
        PurchaseRequest.find({ status: "PENDING" }).populate("warehouse items.product requestedBy").sort({ createdAt: -1 }),
        PurchaseRequest.countDocuments({ status: "APPROVED" }),
        PurchaseOrder.find().populate("vendor warehouse").sort({ createdAt: -1 }).limit(20),
        PurchaseOrder.find({ status: { $in: ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] } }).populate("vendor warehouse"),
        PurchaseOrder.find({
          expectedDate: { $lt: new Date() },
          status: { $nin: ["RECEIVED", "CANCELLED"] },
        }).populate("vendor warehouse"),
        Vendor.countDocuments({ status: "ACTIVE" }),
        PurchaseOrder.aggregate([
          { $match: { status: { $ne: "CANCELLED" } } },
          { $group: { _id: "$vendor", totalSpend: { $sum: "$totalAmount" }, orderCount: { $sum: 1 } } },
          { $sort: { totalSpend: -1 } },
          { $limit: 5 },
          { $lookup: { from: "vendors", localField: "_id", foreignField: "_id", as: "vendorDetails" } },
          { $unwind: "$vendorDetails" },
        ]),
        PurchaseOrder.aggregate([
          { $match: { status: { $ne: "CANCELLED" } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              total: { $sum: "$totalAmount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: 12 },
        ]),
        PurchaseOrder.countDocuments({ vendorAcceptanceStatus: "PENDING" }),
        PurchaseOrder.countDocuments({ vendorAcceptanceStatus: "ACCEPTED" }),
        PurchaseOrder.countDocuments({ vendorAcceptanceStatus: "REJECTED" }),
      ]);

      const lowStock = await getLowStockItems();

      return res.json({
        success: true,
        role: userRole,
        data: {
          pendingRequests: pendingPRs,
          pendingRequestsCount: pendingPRs.length,
          approvedRequestsCount: approvedPRsCount,
          recentOrders: allPOs,
          ordersInFlight: pendingReceivingPOs,
          ordersInFlightCount: pendingReceivingPOs.length,
          overdueDeliveries: overduePOs,
          overdueDeliveriesCount: overduePOs.length,
          vendorAcceptanceMetrics: {
            pending: vendorAcceptancePendingCount,
            accepted: vendorAcceptedCount,
            rejected: vendorRejectedCount,
          },
          vendorSummary: {
            activeVendors: vendorCount,
            topVendors,
          },
          purchaseTrends: monthlyTrends,
          lowStockProducts: lowStock,
        },
      });
    }

    // 2. WAREHOUSE MANAGER OR CENTRAL OPERATIONS MANAGER DASHBOARD
    if (
      userRole === ROLES.WAREHOUSE_MANAGER ||
      userRole === ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER
    ) {
      let invQuery = {};
      let trfQuery = { status: { $in: ["REQUESTED", "APPROVED", "IN_TRANSIT"] } };
      let grnQuery = {};

      if (req.query.warehouse) {
        if (userRole === ROLES.WAREHOUSE_MANAGER) {
          const access = await checkWarehouseAccess(req.user, req.query.warehouse, { requireMutation: false });
          if (!access.allowed) {
            return res.status(access.status || 403).json({ success: false, message: access.message });
          }
        }
        invQuery.warehouse = req.query.warehouse;
        trfQuery.$or = [{ sourceWarehouse: req.query.warehouse }, { destinationWarehouse: req.query.warehouse }];
        grnQuery.warehouse = req.query.warehouse;
      } else if (userRole === ROLES.WAREHOUSE_MANAGER && assignedFilter !== null) {
        const oids = assignedFilter.map((id) => new mongoose.Types.ObjectId(id));
        invQuery.warehouse = { $in: oids };
        trfQuery.$or = [{ sourceWarehouse: { $in: oids } }, { destinationWarehouse: { $in: oids } }];
        grnQuery.warehouse = { $in: oids };
      }

      const movementQuery = invQuery.warehouse ? { warehouse: invQuery.warehouse } : {};

      const [
        allInventory,
        recentMovements,
        pendingTransfers,
        recentGoodsReceipts,
        matrix,
      ] = await Promise.all([
        Inventory.find(invQuery).populate("product", "productName sku costPrice").populate("warehouse", "warehouseName location"),
        StockMovement.find(movementQuery).populate("product", "productName sku").populate("warehouse", "warehouseName").sort({ createdAt: -1 }).limit(15),
        StockTransfer.find(trfQuery).populate("sourceWarehouse destinationWarehouse items.product"),
        GoodsReceipt.find(grnQuery).populate("purchaseOrder warehouse receivedBy").sort({ createdAt: -1 }).limit(10),
        getMultiWarehouseMatrix(req.query.warehouse || (userRole === ROLES.WAREHOUSE_MANAGER ? assignedFilter : null)),
      ]);

      let totalValuation = 0;
      let totalStock = 0;
      let totalReserved = 0;
      let totalDamaged = 0;

      const warehouseBreakdown = {};

      for (const inv of allInventory) {
        const qty = inv.quantity || 0;
        const reserved = inv.reservedStock || 0;
        const damaged = inv.damagedStock || 0;
        const cost = inv.product?.costPrice || 0;

        totalStock += qty;
        totalReserved += reserved;
        totalDamaged += damaged;
        totalValuation += qty * cost;

        const whName = inv.warehouse?.warehouseName || "Unassigned";
        if (!warehouseBreakdown[whName]) {
          warehouseBreakdown[whName] = { totalQuantity: 0, reservedStock: 0, damagedStock: 0, valuation: 0 };
        }
        warehouseBreakdown[whName].totalQuantity += qty;
        warehouseBreakdown[whName].reservedStock += reserved;
        warehouseBreakdown[whName].damagedStock += damaged;
        warehouseBreakdown[whName].valuation += qty * cost;
      }

      const lowStock = await getLowStockItems(req.query.warehouse || assignedFilter);

      return res.json({
        success: true,
        role: userRole,
        data: {
          warehouseInventory: {
            totalStock,
            totalReserved,
            totalDamaged,
            warehouseBreakdown,
          },
          inventoryValuation: totalValuation,
          lowStockProducts: lowStock,
          stockMovements: recentMovements,
          pendingTransfers,
          pendingTransfersCount: pendingTransfers.length,
          goodsReceipts: recentGoodsReceipts,
          multiWarehouseMatrix: matrix,
        },
      });
    }

    // 3. SALES MANAGER DASHBOARD
    if (userRole === ROLES.SALES_MANAGER) {
      const [
        allSalesOrders,
        pendingFulfillments,
        invoices,
        deliveries,
        returns,
        customerCount,
        topCustomers,
        salesTrends,
      ] = await Promise.all([
        SalesOrder.find().populate("customer warehouse items.product").sort({ createdAt: -1 }).limit(20),
        SalesOrder.find({ status: { $in: ["PENDING", "CONFIRMED", "RESERVED", "PROCESSING"] } }).populate("customer warehouse"),
        Invoice.find().populate("salesOrder customer").sort({ createdAt: -1 }).limit(15),
        Delivery.find().populate("salesOrder customer warehouse assignedEmployee").sort({ createdAt: -1 }).limit(15),
        Return.find().populate("salesOrder customer warehouse items.product").sort({ createdAt: -1 }).limit(15),
        Customer.countDocuments({ status: "ACTIVE" }),
        SalesOrder.aggregate([
          { $match: { status: { $ne: "CANCELLED" } } },
          { $group: { _id: "$customer", totalSpent: { $sum: "$totalAmount" }, orderCount: { $sum: 1 } } },
          { $sort: { totalSpent: -1 } },
          { $limit: 5 },
          { $lookup: { from: "customers", localField: "_id", foreignField: "_id", as: "customerDetails" } },
          { $unwind: "$customerDetails" },
        ]),
        SalesOrder.aggregate([
          { $match: { status: { $ne: "CANCELLED" } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              revenue: { $sum: "$totalAmount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: 12 },
        ]),
      ]);

      const reservedOrders = allSalesOrders.filter((so) => so.status === "RESERVED");

      return res.json({
        success: true,
        role: userRole,
        data: {
          salesOrders: allSalesOrders,
          pendingFulfillment: pendingFulfillments,
          pendingFulfillmentCount: pendingFulfillments.length,
          reservations: {
            orders: reservedOrders,
            count: reservedOrders.length,
          },
          invoices,
          deliveries,
          returns,
          customerSummary: {
            activeCustomers: customerCount,
            topCustomers,
          },
          salesTrends,
        },
      });
    }

    // 4. SUPER ADMIN DASHBOARD (Central Multi-Warehouse System View)
    const [
      totalProducts,
      totalWarehouses,
      totalEmployees,
      totalVendors,
      totalCustomers,
      allInventory,
      salesStats,
      purchaseStats,
      pendingPRs,
      pendingPOs,
      pendingTransfers,
      pendingFulfillments,
      pendingDeliveries,
      recentAuditLogs,
      multiWarehouseMatrix,
    ] = await Promise.all([
      Product.countDocuments({ status: "ACTIVE" }),
      Warehouse.countDocuments({ status: "ACTIVE" }),
      Employee.countDocuments({ status: "ACTIVE" }),
      Vendor.countDocuments({ status: "ACTIVE" }),
      Customer.countDocuments({ status: "ACTIVE" }),
      Inventory.find().populate("product", "costPrice"),
      SalesOrder.aggregate([
        { $match: { status: { $ne: "CANCELLED" } } },
        { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" }, totalOrders: { $sum: 1 } } },
      ]),
      PurchaseOrder.aggregate([
        { $match: { status: { $ne: "CANCELLED" } } },
        { $group: { _id: null, totalSpend: { $sum: "$totalAmount" }, totalOrders: { $sum: 1 } } },
      ]),
      PurchaseRequest.countDocuments({ status: "PENDING" }),
      PurchaseOrder.countDocuments({ status: { $in: ["PENDING", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] } }),
      StockTransfer.countDocuments({ status: { $in: ["REQUESTED", "APPROVED", "IN_TRANSIT"] } }),
      SalesOrder.countDocuments({ status: { $in: ["PENDING", "CONFIRMED", "RESERVED", "PROCESSING"] } }),
      Delivery.countDocuments({ status: { $in: ["PENDING", "ASSIGNED", "IN_TRANSIT"] } }),
      AuditLog.find().populate("employee", "name email department role").sort({ timestamp: -1 }).limit(10),
      getMultiWarehouseMatrix(),
    ]);

    let totalValuation = 0;
    let totalStock = 0;
    let totalReserved = 0;
    let totalDamaged = 0;

    for (const inv of allInventory) {
      const qty = inv.quantity || 0;
      totalStock += qty;
      totalReserved += inv.reservedStock || 0;
      totalDamaged += inv.damagedStock || 0;
      totalValuation += qty * (inv.product?.costPrice || 0);
    }

    const lowStock = await getLowStockItems();

    res.json({
      success: true,
      role: userRole,
      data: {
        totalProducts,
        totalWarehouses,
        totalEmployees,
        totalVendors,
        totalCustomers,
        multiWarehouseOverview: multiWarehouseMatrix,
        inventoryOverview: {
          totalStock,
          totalReserved,
          totalDamaged,
          totalValuation,
        },
        purchaseOverview: {
          totalSpend: purchaseStats[0]?.totalSpend || 0,
          totalOrders: purchaseStats[0]?.totalOrders || 0,
          pendingPOs,
        },
        salesOverview: {
          totalRevenue: salesStats[0]?.totalRevenue || 0,
          totalOrders: salesStats[0]?.totalOrders || 0,
          pendingFulfillments,
        },
        lowStockItems: lowStock,
        pendingOperations: {
          pendingPurchaseRequests: pendingPRs,
          pendingPurchaseOrders: pendingPOs,
          pendingTransfers,
          pendingFulfillments,
          pendingDeliveries,
        },
        auditActivity: recentAuditLogs,
        // Legacy summary structure for backward-compatible frontend components
        summary: {
          totalProducts,
          totalWarehouses,
          totalVendors,
          totalCustomers,
          pendingPurchases: pendingPOs,
          pendingPurchaseRequests: pendingPRs,
          pendingSalesOrders: pendingFulfillments,
          lowStockCount: lowStock.length,
          totalSales: salesStats[0]?.totalRevenue || 0,
          totalPurchase: purchaseStats[0]?.totalSpend || 0,
        },
      },
    });
  } catch (e) {
    next(e);
  }
};

/**
 * 5. Individual Warehouse Dashboard
 */
const getWarehouseDashboard = async (req, res, next) => {
  try {
    const warehouseId = req.params.id || req.query.warehouse;
    if (!validId(warehouseId)) {
      return res.status(400).json({ success: false, message: "Invalid Warehouse ID." });
    }

    const access = await checkWarehouseAccess(req.user, warehouseId, { requireMutation: false });
    if (!access.allowed) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const wh = await Warehouse.findById(warehouseId).populate("primaryManager", "name email phone department");
    if (!wh) {
      return res.status(404).json({ success: false, message: "Warehouse not found." });
    }

    const whId = new mongoose.Types.ObjectId(warehouseId);

    const [invItems, recentMovements, pendingTransfers, recentReceipts, pendingPOs, pendingDispatches] = await Promise.all([
      Inventory.find({ warehouse: whId }).populate("product", "productName sku unitPrice costPrice safetyStock reorderPoint"),
      StockMovement.find({ warehouse: whId }).populate("product", "productName sku").sort({ createdAt: -1 }).limit(10),
      StockTransfer.find({
        $or: [{ sourceWarehouse: whId }, { destinationWarehouse: whId }],
        status: { $in: ["REQUESTED", "APPROVED", "IN_TRANSIT"] },
      }).populate("sourceWarehouse destinationWarehouse items.product"),
      GoodsReceipt.find({ warehouse: whId }).populate("purchaseOrder receivedBy").sort({ receivedAt: -1 }).limit(5),
      PurchaseOrder.countDocuments({ warehouse: whId, status: { $in: ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"] } }),
      SalesOrder.countDocuments({ warehouse: whId, status: { $in: ["RESERVED", "PROCESSING", "CONFIRMED"] } }),
    ]);

    let totalStock = 0;
    let totalReserved = 0;
    let totalDamaged = 0;
    let totalValuation = 0;
    let lowStockList = [];

    for (const inv of invItems) {
      const qty = inv.quantity || 0;
      const resv = inv.reservedStock || 0;
      const dmg = inv.damagedStock || 0;
      const cost = inv.product?.costPrice || 0;

      totalStock += qty;
      totalReserved += resv;
      totalDamaged += dmg;
      totalValuation += qty * cost;

      const available = qty - resv;
      const reorder = inv.product?.reorderPoint || inv.reorderPoint || 10;
      if (available <= reorder) {
        lowStockList.push({
          product: inv.product?.productName,
          sku: inv.product?.sku,
          quantity: qty,
          reservedStock: resv,
          availableStock: available,
          reorderPoint: reorder,
        });
      }
    }

    const capacity = wh.capacity || 10000;
    const capacityUtilization = capacity > 0 ? Number(((totalStock / capacity) * 100).toFixed(1)) : 0;

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
        totalStock,
        availableStock: Math.max(0, totalStock - totalReserved),
        reservedStock: totalReserved,
        damagedStock: totalDamaged,
        skuCount: invItems.length,
        totalValuation,
        lowStockCount: lowStockList.length,
      },
      lowStockProducts: lowStockList,
      recentMovements,
      pendingTransfers,
      recentGoodsReceipts: recentReceipts,
      operations: {
        pendingIncomingPOs: pendingPOs,
        pendingSalesDispatches: pendingDispatches,
        activeTransfers: pendingTransfers.length,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboard,
  getWarehouseDashboard,
};

const Product = require("../Models/Product");
const Inventory = require("../Models/Inventory");
const PurchaseOrder = require("../Models/PurchaseOrder");
const SalesOrder = require("../Models/SalesOrder");
const StockMovement = require("../Models/StockMovement");
const StockTransfer = require("../Models/StockTransfer");
const GoodsReceipt = require("../Models/GoodsReceipt");
const Warehouse = require("../Models/Warehouse");
const Vendor = require("../Models/Vendor");
const Customer = require("../Models/Customer");
const AuditLog = require("../Models/AuditLog");
const { normalizeRole, ROLES } = require("../Middleware/roleMiddleware");
const { getAuthorizedWarehouseFilter } = require("../Middleware/warehouseAuthMiddleware");

const report = async (req, res, next) => {
  try {
    const userRole = normalizeRole(req.user?.roleName);
    const type = (req.params.type || "INVENTORY").toUpperCase();

    // Enforce role domain access for reports
    if (userRole !== ROLES.SUPER_ADMIN) {
      if (
        userRole === ROLES.PURCHASE_MANAGER &&
        !["PURCHASE", "VENDOR", "PURCHASE_TRENDS"].includes(type)
      ) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: Purchase Manager cannot access ${type} reports.`,
        });
      }
      if (
        userRole === ROLES.WAREHOUSE_MANAGER &&
        ![
          "INVENTORY",
          "STOCK_TRANSFER",
          "INTER_WAREHOUSE_TRANSFERS",
          "LOW_STOCK",
          "VALUATION",
          "WAREHOUSE_STOCK",
          "WAREHOUSE_RECEIVING",
          "WAREHOUSE_DISPATCH",
          "CONSOLIDATED_INVENTORY",
        ].includes(type)
      ) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: Warehouse Manager cannot access ${type} reports.`,
        });
      }
      if (
        userRole === ROLES.SALES_MANAGER &&
        !["SALES", "SALES_TRENDS", "CUSTOMER", "WAREHOUSE_DISPATCH"].includes(type)
      ) {
        return res.status(403).json({
          success: false,
          message: `Forbidden: Sales Manager cannot access ${type} reports.`,
        });
      }
    }

    // Warehouse filtering for Warehouse Manager
    const assignedFilter = await getAuthorizedWarehouseFilter(req.user);
    const warehouseFilter = req.query.warehouse || (assignedFilter !== null ? { $in: assignedFilter } : null);

    let data;
    switch (type) {
      case "INVENTORY": {
        const invQuery = {};
        if (warehouseFilter) invQuery.warehouse = warehouseFilter;
        data = await Inventory.find(invQuery)
          .populate("product", "productName sku unitPrice costPrice")
          .populate("warehouse", "warehouseName location");
        break;
      }

      case "WAREHOUSE_STOCK": {
        const invQuery = {};
        if (warehouseFilter) invQuery.warehouse = warehouseFilter;
        data = await Inventory.find(invQuery)
          .populate("product", "productName sku unitPrice costPrice barcode safetyStock")
          .populate("warehouse", "warehouseName location capacity status")
          .sort({ warehouse: 1, quantity: -1 });
        break;
      }

      case "CONSOLIDATED_INVENTORY": {
        // Consolidated across all warehouses grouped by product
        const consolidated = await Inventory.aggregate([
          {
            $group: {
              _id: "$product",
              totalQuantity: { $sum: "$quantity" },
              totalReserved: { $sum: "$reservedStock" },
              totalDamaged: { $sum: "$damagedStock" },
              warehousesCount: { $sum: 1 },
              warehouseDetails: {
                $push: {
                  warehouse: "$warehouse",
                  quantity: "$quantity",
                  reservedStock: "$reservedStock",
                },
              },
            },
          },
          {
            $lookup: {
              from: "products",
              localField: "_id",
              foreignField: "_id",
              as: "productDoc",
            },
          },
          { $unwind: "$productDoc" },
          {
            $project: {
              productId: "$_id",
              productName: "$productDoc.productName",
              sku: "$productDoc.sku",
              costPrice: "$productDoc.costPrice",
              unitPrice: "$productDoc.unitPrice",
              totalQuantity: 1,
              totalReserved: 1,
              totalDamaged: 1,
              availableStock: { $subtract: ["$totalQuantity", "$totalReserved"] },
              totalValuation: { $multiply: ["$totalQuantity", { $ifNull: ["$productDoc.costPrice", 0] }] },
              warehousesCount: 1,
            },
          },
          { $sort: { totalQuantity: -1 } },
        ]);
        data = consolidated;
        break;
      }

      case "WAREHOUSE_RECEIVING": {
        const grnQuery = {};
        if (warehouseFilter) grnQuery.warehouse = warehouseFilter;
        data = await GoodsReceipt.find(grnQuery)
          .populate("purchaseOrder", "purchaseOrderNumber orderDate status")
          .populate("warehouse", "warehouseName location")
          .populate("receivedBy", "name email")
          .populate("items.product", "productName sku")
          .sort({ receivedAt: -1 })
          .limit(100);
        break;
      }

      case "WAREHOUSE_DISPATCH": {
        const soQuery = { status: { $in: ["FULFILLED", "SHIPPED", "DELIVERED"] } };
        if (warehouseFilter) soQuery.warehouse = warehouseFilter;
        data = await SalesOrder.find(soQuery)
          .populate("customer", "customerName phone email")
          .populate("warehouse", "warehouseName location")
          .populate("items.product", "productName sku")
          .sort({ updatedAt: -1 })
          .limit(100);
        break;
      }

      case "LOW_STOCK": {
        const invQuery = {};
        if (warehouseFilter) invQuery.warehouse = warehouseFilter;
        const allInv = await Inventory.find(invQuery)
          .populate("product", "productName sku costPrice unitPrice averageDailyDemand leadTimeDays safetyStock reorderPoint")
          .populate("warehouse", "warehouseName location");
        data = allInv
          .filter((i) => {
            if (!i.product) return false;
            const reorder = i.product.reorderPoint !== undefined && i.product.reorderPoint !== null
              ? i.product.reorderPoint
              : (i.product.averageDailyDemand || 0) * (i.product.leadTimeDays || 0) + (i.product.safetyStock || 0);
            return (i.quantity - (i.reservedStock || 0)) <= reorder;
          })
          .map((i) => {
            const reorder = i.product.reorderPoint !== undefined && i.product.reorderPoint !== null
              ? i.product.reorderPoint
              : (i.product.averageDailyDemand || 0) * (i.product.leadTimeDays || 0) + (i.product.safetyStock || 0);
            return {
              product: i.product.productName,
              sku: i.product.sku,
              warehouse: i.warehouse?.warehouseName,
              quantity: i.quantity,
              reservedStock: i.reservedStock || 0,
              availableStock: i.quantity - (i.reservedStock || 0),
              reorderPoint: reorder,
            };
          });
        break;
      }

      case "VALUATION": {
        const invQuery = {};
        if (warehouseFilter) invQuery.warehouse = warehouseFilter;
        const valuationInv = await Inventory.find(invQuery)
          .populate("product", "productName sku costPrice unitPrice")
          .populate("warehouse", "warehouseName location");
        data = valuationInv.map((i) => {
          const cost = i.product?.costPrice || 0;
          const totalValuation = (i.quantity || 0) * cost;
          return {
            product: i.product?.productName || "Unknown",
            sku: i.product?.sku || "",
            warehouse: i.warehouse?.warehouseName || "Unknown",
            quantity: i.quantity,
            costPrice: cost,
            totalValuation,
          };
        });
        break;
      }

      case "PURCHASE":
        data = await PurchaseOrder.find()
          .populate("vendor", "vendorName phone email")
          .populate("warehouse", "warehouseName location");
        break;

      case "PURCHASE_TRENDS":
        data = await PurchaseOrder.aggregate([
          { $match: { status: { $ne: "CANCELLED" } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              totalSpend: { $sum: "$totalAmount" },
              totalOrders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]);
        break;

      case "SALES":
        data = await SalesOrder.find()
          .populate("customer", "customerName phone email")
          .populate("warehouse", "warehouseName location");
        break;

      case "SALES_TRENDS":
        data = await SalesOrder.aggregate([
          { $match: { status: { $ne: "CANCELLED" } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              revenue: { $sum: "$totalAmount" },
              totalOrders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]);
        break;

      case "STOCK_TRANSFER":
      case "INTER_WAREHOUSE_TRANSFERS": {
        const trfQuery = {};
        if (warehouseFilter) {
          trfQuery.$or = [{ sourceWarehouse: warehouseFilter }, { destinationWarehouse: warehouseFilter }];
        }
        data = await StockTransfer.find(trfQuery)
          .populate("sourceWarehouse destinationWarehouse requestedBy approvedBy")
          .populate("items.product", "productName sku")
          .sort({ createdAt: -1 });
        break;
      }

      case "VENDOR":
        data = await Vendor.find();
        break;

      case "CUSTOMER":
        data = await Customer.find();
        break;

      case "AUDIT":
        data = await AuditLog.find()
          .populate("employee", "name email department role")
          .sort({ timestamp: -1 })
          .limit(100);
        break;

      default:
        return res
          .status(400)
          .json({ success: false, message: `Unsupported report type: ${type}` });
    }

    res.json({ success: true, reportType: type, count: Array.isArray(data) ? data.length : 1, data });
  } catch (e) {
    next(e);
  }
};

module.exports = { report };

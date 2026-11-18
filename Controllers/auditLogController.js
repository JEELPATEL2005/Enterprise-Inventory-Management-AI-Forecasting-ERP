const AuditLog = require("../Models/AuditLog");

const ROLE_SCOPES = {
  SUPER_ADMIN: null, // Full access to all logs
  PURCHASE_MANAGER: [
    "PURCHASE",
    "PURCHASE_ORDER",
    "PURCHASE_REQUEST",
    "VENDOR",
    "GOODS_RECEIPT",
  ],
  WAREHOUSE_MANAGER: [
    "INVENTORY",
    "STOCK_MOVEMENT",
    "STOCK_TRANSFER",
    "WAREHOUSE",
    "GOODS_RECEIPT",
  ],
  SALES_MANAGER: [
    "SALES_ORDER",
    "CUSTOMER",
    "INVOICE",
    "DELIVERY",
    "RETURN",
  ],
};

const list = async (req, res, next) => {
  try {
    const filter = {};
    const userRole = (req.user?.roleName || "").toUpperCase();
    const allowedModules = ROLE_SCOPES[userRole];

    if (allowedModules) {
      // Non-super-admins can see logs belonging to their modules OR actions performed by themselves
      filter.$or = [
        { entityType: { $in: allowedModules } },
        { employee: req.user.id },
      ];
    }

    if (req.query.employee || req.query.userId) {
      filter.employee = req.query.employee || req.query.userId;
    }
    if (req.query.action) {
      filter.action = { $regex: req.query.action, $options: "i" };
    }
    const moduleFilter = req.query.entityType || req.query.module;
    if (moduleFilter) {
      const targetMod = moduleFilter.toUpperCase();
      if (!allowedModules || allowedModules.includes(targetMod)) {
        filter.entityType = targetMod;
      }
    }
    if (req.query.entityId) {
      filter.entityId = req.query.entityId;
    }

    if (req.query.startDate || req.query.endDate) {
      filter.timestamp = {};
      if (req.query.startDate) {
        const s = new Date(req.query.startDate);
        if (isNaN(s.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid startDate format." });
        }
        filter.timestamp.$gte = s;
      }
      if (req.query.endDate) {
        const e = new Date(req.query.endDate);
        if (isNaN(e.getTime())) {
          return res.status(400).json({ success: false, message: "Invalid endDate format." });
        }
        if (req.query.endDate.length === 10) {
          e.setHours(23, 59, 59, 999);
        }
        filter.timestamp.$lte = e;
      }
      if (filter.timestamp.$gte && filter.timestamp.$lte && filter.timestamp.$gte > filter.timestamp.$lte) {
        return res.status(400).json({ success: false, message: "startDate cannot be after endDate." });
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [total, logs] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .populate("employee", "name email department role")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    res.json({
      success: true,
      count: logs.length,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: logs,
    });
  } catch (error) {
    next(error);
  }
};

const get = async (req, res, next) => {
  try {
    const log = await AuditLog.findById(req.params.id).populate(
      "employee",
      "name email department role"
    );

    if (!log) {
      return res.status(404).json({ success: false, message: "Audit log entry not found." });
    }

    const userRole = (req.user?.roleName || "").toUpperCase();
    const allowedModules = ROLE_SCOPES[userRole];
    if (allowedModules) {
      const hasAccess =
        allowedModules.includes(log.entityType) ||
        String(log.employee?._id || log.employee) === String(req.user.id);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "Forbidden: You do not have permission to view this audit log entry.",
        });
      }
    }

    res.json({ success: true, data: log });
  } catch (error) {
    next(error);
  }
};

module.exports = { list, get };


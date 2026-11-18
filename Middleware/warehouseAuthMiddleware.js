const mongoose = require("mongoose");
const Warehouse = require("../Models/Warehouse");
const { normalizeRole, ROLES } = require("./roleMiddleware");

/**
 * Validates MongoDB ObjectId
 */
const isValidObjectId = (id) => {
  return Boolean(id && mongoose.Types.ObjectId.isValid(String(id)));
};

/**
 * Checks whether a user can access or modify a specific warehouse facility
 *
 * @param {Object} user - Logged-in user from req.user
 * @param {string|ObjectId} warehouseId - Target warehouse ID
 * @param {Object} options - { requireMutation: boolean }
 * @returns {Promise<{ allowed: boolean, status?: number, message?: string }>}
 */
const checkWarehouseAccess = async (user, warehouseId, options = {}) => {
  const { requireMutation = false } = options;

  if (!user || !user.roleName) {
    return {
      allowed: false,
      status: 401,
      message: "Authentication required.",
    };
  }

  const role = normalizeRole(user.roleName);

  // 1. Super Admin has unrestricted authorized access across all warehouses
  if (role === ROLES.SUPER_ADMIN) {
    return { allowed: true };
  }

  // 2. Central Warehouse Operations Manager can monitor all warehouses,
  // but cannot perform unrestricted physical stock modifications.
  if (role === ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER) {
    if (requireMutation) {
      return {
        allowed: false,
        status: 403,
        message: "Forbidden: Central Warehouse Operations Manager has read-only monitoring access and cannot modify warehouse stock.",
      };
    }
    return { allowed: true };
  }

  // 3. Purchase Manager and Sales Manager can view stock availability for procurement/fulfillment,
  // but cannot mutate physical warehouse inventories directly.
  if (role === ROLES.PURCHASE_MANAGER || role === ROLES.SALES_MANAGER) {
    if (requireMutation) {
      return {
        allowed: false,
        status: 403,
        message: `Forbidden: Role '${role}' cannot directly modify warehouse stock.`,
      };
    }
    return { allowed: true };
  }

  // 4. Warehouse Manager: Can only access and mutate assigned warehouses
  if (role === ROLES.WAREHOUSE_MANAGER) {
    if (!warehouseId || !isValidObjectId(warehouseId)) {
      return {
        allowed: false,
        status: 400,
        message: "Invalid or missing Warehouse ID.",
      };
    }

    const whIdStr = String(warehouseId);
    const assigned = (user.assignedWarehouses || []).map((w) => String(w));

    if (assigned.includes(whIdStr)) {
      return { allowed: true };
    }

    // Also check if user is designated as primaryManager on the Warehouse document
    const whDoc = await Warehouse.findById(warehouseId).select("primaryManager status");
    if (!whDoc) {
      return {
        allowed: false,
        status: 404,
        message: "Warehouse facility not found.",
      };
    }

    if (whDoc.primaryManager && String(whDoc.primaryManager) === String(user.id)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      status: 403,
      message: `Forbidden: You are not assigned to manage warehouse facility '${warehouseId}'.`,
    };
  }

  // Default deny for unknown or employee role
  return {
    allowed: false,
    status: 403,
    message: `Forbidden: Access denied for role '${role}'.`,
  };
};

/**
 * Express middleware to verify warehouse-specific access
 */
const verifyWarehouseAccess = (options = {}) => {
  const {
    paramKey = "warehouseId",
    bodyKey = "warehouse",
    queryKey = "warehouse",
    requireMutation = true,
  } = options;

  return async (req, res, next) => {
    try {
      const warehouseId =
        req.params[paramKey] ||
        req.body[bodyKey] ||
        req.body.warehouseId ||
        req.query[queryKey] ||
        req.query.warehouseId;

      if (!warehouseId) {
        return res.status(400).json({
          success: false,
          message: `Warehouse ID is required in ${paramKey ? 'params.' + paramKey : 'request'}.`,
        });
      }

      if (!isValidObjectId(warehouseId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Warehouse ObjectId format.",
        });
      }

      const access = await checkWarehouseAccess(req.user, warehouseId, { requireMutation });
      if (!access.allowed) {
        return res.status(access.status || 403).json({
          success: false,
          message: access.message,
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

/**
 * Returns authorized warehouse filter for database queries
 */
const getAuthorizedWarehouseFilter = async (user) => {
  const role = normalizeRole(user?.roleName);

  if (
    role === ROLES.SUPER_ADMIN ||
    role === ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER ||
    role === ROLES.PURCHASE_MANAGER ||
    role === ROLES.SALES_MANAGER
  ) {
    return null; // No warehouse restriction (all warehouses)
  }

  if (role === ROLES.WAREHOUSE_MANAGER) {
    const assigned = (user.assignedWarehouses || []).map((w) => String(w));
    // Find warehouses where this user is primaryManager
    const managedWarehouses = await Warehouse.find({ primaryManager: user.id }).select("_id");
    const managedIds = managedWarehouses.map((w) => String(w._id));
    const allIds = Array.from(new Set([...assigned, ...managedIds]));
    return allIds;
  }

  return [];
};

module.exports = {
  checkWarehouseAccess,
  verifyWarehouseAccess,
  getAuthorizedWarehouseFilter,
  isValidObjectId,
};


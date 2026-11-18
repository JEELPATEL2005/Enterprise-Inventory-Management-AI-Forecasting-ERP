const { verifyAccessToken } = require("../services/authService");
const Employee = require("../Models/Employee");
const { normalizeRole } = require("./roleMiddleware");

const authenticate = async (req, res, next) => {
  try {
    // Exclude public vendor response endpoints from bearer token requirement (Phase 7.4)
    if (
      req.path.startsWith("/purchase-orders/vendor-response") ||
      req.path.startsWith("/purchases/vendor-response")
    ) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Bearer token missing.",
      });
    }

    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Access token is invalid or expired.",
        code: "TOKEN_EXPIRED",
      });
    }

    // Verify employee exists and is active, and fetch fresh assigned warehouses
    const employee = await Employee.findById(decoded.id).select("status assignedWarehouses");
    if (!employee || employee.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "User account is suspended, inactive, or no longer exists.",
      });
    }

    req.user = {
      ...decoded,
      assignedWarehouses: (employee.assignedWarehouses || []).map((w) => String(w)),
      roleName: normalizeRole(decoded.roleName),
      originalRoleName: decoded.roleName,
    };
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = authenticate;

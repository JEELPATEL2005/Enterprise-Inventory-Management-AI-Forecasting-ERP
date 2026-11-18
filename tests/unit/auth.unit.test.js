/**
 * Unit Tests: Authorization & Role Middleware
 * Tests normalizeRole(), authorize(), and checkPermission() middleware.
 */
const authorize = require("../../Middleware/roleMiddleware");
const { normalizeRole, ROLES } = authorize;
const checkPermission = require("../../Middleware/PermissionMiddleware");

describe("normalizeRole()", () => {
  test("normalizes SUPER_ADMIN variants", () => {
    expect(normalizeRole("SUPER_ADMIN")).toBe(ROLES.SUPER_ADMIN);
    expect(normalizeRole("SuperAdmin")).toBe(ROLES.SUPER_ADMIN);
    expect(normalizeRole("ADMIN")).toBe(ROLES.SUPER_ADMIN);
    expect(normalizeRole("super admin")).toBe(ROLES.SUPER_ADMIN);
    expect(normalizeRole("super-admin")).toBe(ROLES.SUPER_ADMIN);
  });

  test("normalizes PURCHASE_MANAGER variants", () => {
    expect(normalizeRole("PURCHASE_MANAGER")).toBe(ROLES.PURCHASE_MANAGER);
    expect(normalizeRole("PURCHASE")).toBe(ROLES.PURCHASE_MANAGER);
    expect(normalizeRole("purchase_manager")).toBe(ROLES.PURCHASE_MANAGER);
  });

  test("normalizes WAREHOUSE_MANAGER variants", () => {
    expect(normalizeRole("WAREHOUSE_MANAGER")).toBe(ROLES.WAREHOUSE_MANAGER);
    expect(normalizeRole("WAREHOUSE")).toBe(ROLES.WAREHOUSE_MANAGER);
    expect(normalizeRole("warehouse manager")).toBe(ROLES.WAREHOUSE_MANAGER);
  });

  test("normalizes SALES_MANAGER variants", () => {
    expect(normalizeRole("SALES_MANAGER")).toBe(ROLES.SALES_MANAGER);
    expect(normalizeRole("SALES")).toBe(ROLES.SALES_MANAGER);
    expect(normalizeRole("sales_manager")).toBe(ROLES.SALES_MANAGER);
  });

  test("returns empty string for null/undefined", () => {
    expect(normalizeRole(null)).toBe("");
    expect(normalizeRole(undefined)).toBe("");
    expect(normalizeRole("")).toBe("");
  });

  test("returns cleaned string for unknown roles", () => {
    expect(normalizeRole("CUSTOM_ROLE")).toBe("CUSTOM_ROLE");
  });
});

describe("authorize() middleware", () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };
  const mockNext = jest.fn();

  beforeEach(() => {
    mockNext.mockClear();
  });

  test("returns 401 when req.user is missing", () => {
    const req = {};
    const res = mockRes();
    authorize(ROLES.PURCHASE_MANAGER)(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  test("returns 401 when req.user.roleName is missing", () => {
    const req = { user: {} };
    const res = mockRes();
    authorize(ROLES.PURCHASE_MANAGER)(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  test("SUPER_ADMIN bypasses all role restrictions", () => {
    const req = { user: { roleName: ROLES.SUPER_ADMIN } };
    const res = mockRes();
    authorize(ROLES.PURCHASE_MANAGER)(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test("authorized role is allowed", () => {
    const req = { user: { roleName: ROLES.PURCHASE_MANAGER } };
    const res = mockRes();
    authorize(ROLES.PURCHASE_MANAGER, ROLES.WAREHOUSE_MANAGER)(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  test("unauthorized role is denied with 403", () => {
    const req = { user: { roleName: ROLES.SALES_MANAGER } };
    const res = mockRes();
    authorize(ROLES.PURCHASE_MANAGER, ROLES.WAREHOUSE_MANAGER)(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  test("no role restriction allows any authenticated user", () => {
    const req = { user: { roleName: ROLES.SALES_MANAGER } };
    const res = mockRes();
    authorize()(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});

describe("checkPermission() middleware", () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };
  const mockNext = jest.fn();

  beforeEach(() => {
    mockNext.mockClear();
  });

  test("returns 401 when req.user is missing", () => {
    const req = {};
    const res = mockRes();
    checkPermission("inventory.view")(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test("SUPER_ADMIN bypasses permission checks", () => {
    const req = { user: { roleName: ROLES.SUPER_ADMIN, permissions: [] } };
    const res = mockRes();
    checkPermission("inventory.view")(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  test("user with required permission is allowed", () => {
    const req = {
      user: {
        roleName: ROLES.WAREHOUSE_MANAGER,
        permissions: ["inventory.view", "stock.in"],
      },
    };
    const res = mockRes();
    checkPermission("inventory.view")(req, res, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  test("user without required permission is denied with 403", () => {
    const req = {
      user: {
        roleName: ROLES.SALES_MANAGER,
        permissions: ["customer.view", "sales_order.create"],
      },
    };
    const res = mockRes();
    checkPermission("inventory.manage")(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("multiple permissions must all be present", () => {
    const req = {
      user: {
        roleName: ROLES.WAREHOUSE_MANAGER,
        permissions: ["inventory.view"],
      },
    };
    const res = mockRes();
    checkPermission("inventory.view", "stock.in")(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

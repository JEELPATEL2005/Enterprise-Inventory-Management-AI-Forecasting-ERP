/**
 * Integration Tests: RBAC / Permission Testing
 * Tests every protected API with each role to verify backend authorization.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");

let tokens;

beforeAll(async () => {
  const seedData = await helpers.seedTestDatabase();
  tokens = {
    superAdmin: helpers.getTokenForRole("SUPER_ADMIN", seedData),
    purchaseManager: helpers.getTokenForRole("PURCHASE_MANAGER", seedData),
    warehouseManager: helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData),
    salesManager: helpers.getTokenForRole("SALES_MANAGER", seedData),
  };
});

/**
 * Helper to test endpoint authorization.
 * @param {string} method - HTTP method (get/post/put/delete)
 * @param {string} path - API path
 * @param {Object} body - Request body (for post/put)
 * @param {string[]} allowedTokenKeys - Keys from tokens object that should succeed
 * @param {string[]} deniedTokenKeys - Keys from tokens object that should get 403
 */
const testRBAC = (method, path, body, allowedTokenKeys, deniedTokenKeys) => {
  // No token → 401
  test(`${method.toUpperCase()} ${path} - No token → 401`, async () => {
    const res = await request(app)[method](path);
    expect(res.statusCode).toBe(401);
  });

  // Invalid token → 401
  test(`${method.toUpperCase()} ${path} - Invalid token → 401`, async () => {
    const res = await request(app)[method](path)
      .set("Authorization", "Bearer invalid-token");
    expect(res.statusCode).toBe(401);
  });

  // Allowed roles
  for (const key of allowedTokenKeys) {
    test(`${method.toUpperCase()} ${path} - ${key} → success`, async () => {
      let req = request(app)[method](path)
        .set("Authorization", `Bearer ${tokens[key]}`);
      if (body && (method === "post" || method === "put" || method === "delete")) {
        req = req.send(body);
      }
      const res = await req;
      expect([401, 403]).not.toContain(res.statusCode);
    });
  }

  // Denied roles → 403
  for (const key of deniedTokenKeys) {
    test(`${method.toUpperCase()} ${path} - ${key} → 403`, async () => {
      let req = request(app)[method](path)
        .set("Authorization", `Bearer ${tokens[key]}`);
      if (body && (method === "post" || method === "put" || method === "delete")) {
        req = req.send(body);
      }
      const res = await req;
      expect(res.statusCode).toBe(403);
    });
  }
};

describe("RBAC: Products", () => {
  testRBAC("get", "/api/products", null,
    ["superAdmin", "purchaseManager", "warehouseManager", "salesManager"],
    []
  );

  testRBAC("post", "/api/products", { productName: "RBAC Test", sku: "RBAC-001", unitPrice: 50, category: new mongoose.Types.ObjectId() },
    ["superAdmin"],
    ["purchaseManager", "warehouseManager", "salesManager"]
  );
});

describe("RBAC: Vendors", () => {
  testRBAC("get", "/api/vendors", null,
    ["superAdmin", "purchaseManager"],
    ["warehouseManager", "salesManager"]
  );

  testRBAC("post", "/api/vendors", { vendorName: "RBAC Vendor", phone: "1234567890" },
    ["superAdmin", "purchaseManager"],
    ["warehouseManager", "salesManager"]
  );
});

describe("RBAC: Customers", () => {
  testRBAC("get", "/api/customers", null,
    ["superAdmin", "salesManager"],
    ["purchaseManager", "warehouseManager"]
  );

  testRBAC("post", "/api/customers", { customerName: "RBAC Cust", phone: "1234567890" },
    ["superAdmin", "salesManager"],
    ["purchaseManager", "warehouseManager"]
  );
});

describe("RBAC: Warehouses", () => {
  testRBAC("get", "/api/warehouses", null,
    ["superAdmin", "purchaseManager", "warehouseManager", "salesManager"],
    []
  );

  testRBAC("post", "/api/warehouses", { warehouseName: "RBAC WH", location: "Test", capacity: 100 },
    ["superAdmin"],
    ["purchaseManager", "warehouseManager", "salesManager"]
  );
});

describe("RBAC: Inventory", () => {
  testRBAC("get", "/api/inventory", null,
    ["superAdmin", "purchaseManager", "warehouseManager", "salesManager"],
    []
  );

  testRBAC("post", "/api/inventory/stock-in", { product: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId(), quantity: 10 },
    ["superAdmin", "warehouseManager"],
    ["purchaseManager", "salesManager"]
  );

  testRBAC("post", "/api/inventory/stock-out", { product: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId(), quantity: 10 },
    ["superAdmin", "warehouseManager"],
    ["purchaseManager", "salesManager"]
  );
});

describe("RBAC: Purchase Orders", () => {
  testRBAC("get", "/api/purchases", null,
    ["superAdmin", "purchaseManager", "warehouseManager"],
    ["salesManager"]
  );

  testRBAC("post", "/api/purchases", { vendor: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId(), items: [] },
    ["superAdmin", "purchaseManager"],
    ["warehouseManager", "salesManager"]
  );
});

describe("RBAC: Purchase Requests", () => {
  testRBAC("get", "/api/purchase-requests", null,
    ["superAdmin", "purchaseManager", "warehouseManager"],
    ["salesManager"]
  );
  testRBAC("post", "/api/purchase-requests", {
    warehouse: new mongoose.Types.ObjectId(),
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 10 }],
    reason: "Low stock",
  },
    ["superAdmin", "warehouseManager"],
    ["purchaseManager", "salesManager"]
  );
});

describe("RBAC: Sales Orders", () => {
  testRBAC("get", "/api/sales-orders", null,
    ["superAdmin", "salesManager", "warehouseManager"],
    ["purchaseManager"]
  );

  testRBAC("post", "/api/sales-orders", { customer: new mongoose.Types.ObjectId(), warehouse: new mongoose.Types.ObjectId(), items: [] },
    ["superAdmin", "salesManager"],
    ["purchaseManager", "warehouseManager"]
  );
});

describe("RBAC: Invoices", () => {
  testRBAC("get", "/api/invoices", null,
    ["superAdmin", "salesManager", "warehouseManager"],
    ["purchaseManager"]
  );

  testRBAC("post", "/api/invoices", { salesOrder: new mongoose.Types.ObjectId() },
    ["superAdmin", "salesManager"],
    ["purchaseManager", "warehouseManager"]
  );
});

describe("RBAC: Deliveries", () => {
  testRBAC("get", "/api/deliveries", null,
    ["superAdmin", "salesManager", "warehouseManager"],
    ["purchaseManager"]
  );

  testRBAC("post", "/api/deliveries", { salesOrder: new mongoose.Types.ObjectId() },
    ["superAdmin", "salesManager"],
    ["purchaseManager", "warehouseManager"]
  );
});

describe("RBAC: Returns", () => {
  testRBAC("get", "/api/returns", null,
    ["superAdmin", "salesManager", "warehouseManager"],
    ["purchaseManager"]
  );

  testRBAC("post", "/api/returns", { salesOrder: new mongoose.Types.ObjectId(), items: [], reason: "test" },
    ["superAdmin", "salesManager"],
    ["purchaseManager", "warehouseManager"]
  );
});

describe("RBAC: Stock Transfers", () => {
  testRBAC("get", "/api/stock-transfers", null,
    ["superAdmin", "warehouseManager", "purchaseManager", "salesManager"],
    []
  );

  testRBAC("post", "/api/stock-transfers", { sourceWarehouse: new mongoose.Types.ObjectId(), destinationWarehouse: new mongoose.Types.ObjectId(), items: [] },
    ["superAdmin", "warehouseManager"],
    ["purchaseManager", "salesManager"]
  );
});

describe("RBAC: Goods Receipts", () => {
  testRBAC("get", "/api/goods-receipts", null,
    ["superAdmin", "purchaseManager", "warehouseManager"],
    ["salesManager"]
  );
});

describe("RBAC: Stock Movements", () => {
  testRBAC("get", "/api/stock-movements", null,
    ["superAdmin", "warehouseManager"],
    ["purchaseManager", "salesManager"]
  );
});

describe("RBAC: Audit Logs", () => {
  testRBAC("get", "/api/audit-logs", null,
    ["superAdmin", "purchaseManager", "warehouseManager", "salesManager"],
    []
  );
});

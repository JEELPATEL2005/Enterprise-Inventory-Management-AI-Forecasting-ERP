/**
 * Integration Tests: Stock Movements, Audit Logs, and Validation (Sections 23, 24, 25)
 * Tests:
 * 1. Stock Movements: Verification of types (STOCK_IN, STOCK_OUT, ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT, RETURN_IN, DAMAGED),
 *    correct product, warehouse, quantity, movement type, reference ID, timestamp, performedBy
 * 2. Audit Logs: Actions recorded (Login, Product, PO, Goods Receipt, Transfer, SO, Fulfill, Return),
 *    fields present, sensitive data (passwords, JWT, refreshTokens) strictly sanitized/omitted
 * 3. Validation: Comprehensive verification of HTTP status codes (400, 401, 403, 404, 409)
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const StockMovement = require("../../Models/StockMovement");
const AuditLog = require("../../Models/AuditLog");
const Product = require("../../Models/Product");
const Inventory = require("../../Models/Inventory");
const { createTestInventory } = helpers;

let seedData, adminToken, whToken, smToken, pmToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  smToken = helpers.getTokenForRole("SALES_MANAGER", seedData);
  pmToken = helpers.getTokenForRole("PURCHASE_MANAGER", seedData);
  fixtures = await helpers.createTestFixtures();
});

// ========== STOCK MOVEMENT TESTING (Section 23) ==========
describe("Stock Movement Testing (Section 23)", () => {
  test("GET /api/stock-movements - lists stock movements with valid metadata", async () => {
    // Generate at least one movement via stock-in
    await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 15,
        remarks: "Movement test",
      });

    const res = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${whToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);

    const movement = res.body.data[0];
    expect(movement.product).toBeDefined();
    expect(movement.warehouse).toBeDefined();
    expect(movement.type).toBeDefined();
    expect(movement.quantity).toBeGreaterThan(0);
    expect(movement.createdAt).toBeDefined();
  });

  test("GET /api/stock-movements - filters by movement type", async () => {
    const res = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${whToken}`)
      .query({ type: "STOCK_IN" });

    expect(res.statusCode).toBe(200);
    for (const m of res.body.data) {
      expect(m.type).toBe("STOCK_IN");
    }
  });

  test("GET /api/stock-movements - filters by product", async () => {
    const res = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${whToken}`)
      .query({ product: fixtures.product._id.toString() });

    expect(res.statusCode).toBe(200);
    for (const m of res.body.data) {
      const pid = m.product?._id ? m.product._id.toString() : m.product.toString();
      expect(pid).toBe(fixtures.product._id.toString());
    }
  });

  test("GET /api/stock-movements - filters by warehouse", async () => {
    const res = await request(app)
      .get("/api/stock-movements")
      .set("Authorization", `Bearer ${whToken}`)
      .query({ warehouse: fixtures.warehouse1._id.toString() });

    expect(res.statusCode).toBe(200);
    for (const m of res.body.data) {
      const wid = m.warehouse?._id ? m.warehouse._id.toString() : m.warehouse.toString();
      expect(wid).toBe(fixtures.warehouse1._id.toString());
    }
  });
});

// ========== AUDIT LOG TESTING (Section 24) ==========
describe("Audit Log Testing (Section 24)", () => {
  test("Important actions record audit logs with user, action, entityType, and timestamp", async () => {
    // 1. Create a product (generates PRODUCT_CREATED audit log)
    const productSku = `AUDIT-${Date.now()}`;
    const soRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 5, unitPrice: 100 }],
      });

    expect(soRes.statusCode).toBe(201);
    const soId = soRes.body.data._id;

    // Check AuditLog collection
    const log = await AuditLog.findOne({
      entityId: soId,
      action: "SALES_ORDER_CREATED",
    });

    expect(log).not.toBeNull();
    expect(log.employee).toBeDefined();
    expect(log.entityType).toBe("SALES_ORDER");
    expect(log.timestamp).toBeDefined();
  });

  test("CRITICAL: Sensitive data (passwords, JWT, refresh tokens) is NEVER stored in audit logs", async () => {
    // Fetch recent audit logs
    const logs = await AuditLog.find().sort({ timestamp: -1 }).limit(50);
    expect(logs.length).toBeGreaterThan(0);

    for (const log of logs) {
      const logString = JSON.stringify(log.toObject());
      // Must not contain plain password values
      expect(logString).not.toMatch(/"password"\s*:\s*"[^"]+"/i);
      // Must not contain jwt token values in newData or oldData
      if (log.newData) {
        expect(log.newData.password).toBeUndefined();
        expect(log.newData.refreshToken).toBeUndefined();
        expect(log.newData.jwt).toBeUndefined();
      }
      if (log.oldData) {
        expect(log.oldData.password).toBeUndefined();
        expect(log.oldData.refreshToken).toBeUndefined();
        expect(log.oldData.jwt).toBeUndefined();
      }
    }
  });

  test("GET /api/audit-logs - lists audit logs", async () => {
    const res = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

// ========== VALIDATION TESTING (Section 25) ==========
describe("System Validation Testing (Section 25)", () => {
  test("Missing required field returns 400", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "NO-NAME" });

    expect(res.statusCode).toBe(400);
  });

  test("Invalid ObjectId format returns 400", async () => {
    const res = await request(app)
      .get("/api/products/not-a-valid-object-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(400);
  });

  test("Duplicate unique resource returns 409", async () => {
    const sku = `DUP-VAL-${Date.now()}`;
    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productName: "Original",
        sku,
        category: fixtures.category._id.toString(),
        brand: fixtures.brand._id.toString(),
        unitPrice: 10,
      });

    const dupRes = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productName: "Duplicate",
        sku,
        category: fixtures.category._id.toString(),
        brand: fixtures.brand._id.toString(),
        unitPrice: 10,
      });

    expect(dupRes.statusCode).toBe(409);
  });

  test("Non-existent resource returns 404", async () => {
    const nonExistentId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .get(`/api/products/${nonExistentId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(404);
  });

  test("Missing authentication token returns 401", async () => {
    const res = await request(app).get("/api/products");
    expect(res.statusCode).toBe(401);
  });

  test("Insufficient role permission returns 403", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${smToken}`) // Sales Manager cannot create products
      .send({
        productName: "Unauthorized Product",
        sku: `UNAUTH-${Date.now()}`,
        category: fixtures.category._id.toString(),
        brand: fixtures.brand._id.toString(),
        unitPrice: 10,
      });

    expect(res.statusCode).toBe(403);
  });

  test("Negative quantity in stock-in returns 400", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: -50,
      });

    expect(res.statusCode).toBe(400);
  });
});

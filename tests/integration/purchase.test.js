/**
 * Integration Tests: Purchase Request, Purchase Order, and Goods Receipt
 * Tests the full procurement lifecycle including the critical business rule
 * that creating/approving POs must NOT increase inventory — only Goods Receipt does.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");

let seedData, pmToken, adminToken, whToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  pmToken = helpers.getTokenForRole("PURCHASE_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  fixtures = await helpers.createTestFixtures();
});

// ========== PURCHASE REQUEST TESTS ==========
describe("Purchase Request API", () => {
  let prId;

  test("POST /api/purchase-requests - should create purchase request by Warehouse Manager", async () => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 50 }],
        reason: "Low stock",
        priority: "HIGH",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    prId = res.body.data._id;
  });

  test("POST /api/purchase-requests - should reject Purchase Manager from creating PR with 403", async () => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 50 }],
        reason: "Low stock",
        priority: "HIGH",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/access denied|cannot create/i);
  });

  test("GET /api/purchase-requests - should list purchase requests", async () => {
    const res = await request(app)
      .get("/api/purchase-requests")
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/purchase-requests/:id - should get single PR", async () => {
    const res = await request(app)
      .get(`/api/purchase-requests/${prId}`)
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("PENDING");
  });

  test("PUT /api/purchase-requests/:id/approve - should approve PR", async () => {
    const res = await request(app)
      .put(`/api/purchase-requests/${prId}/approve`)
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("APPROVED");
  });

  test("PUT /api/purchase-requests/:id/approve - should reject re-approving", async () => {
    const res = await request(app)
      .put(`/api/purchase-requests/${prId}/approve`)
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(400);
  });

  test("should reject invalid status transitions (APPROVED → REJECTED via approve)", async () => {
    const res = await request(app)
      .put(`/api/purchase-requests/${prId}/reject`)
      .set("Authorization", `Bearer ${pmToken}`);

    // Already APPROVED, can only transition from PENDING
    expect(res.statusCode).toBe(400);
  });

  test("POST /api/purchase-requests - should reject missing items", async () => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set("Authorization", `Bearer ${whToken}`)
      .send({ warehouse: fixtures.warehouse1._id.toString() });

    expect(res.statusCode).toBe(400);
  });
});

// ========== PURCHASE ORDER TESTS ==========
describe("Purchase Order API", () => {
  let poId;

  test("POST /api/purchases - should create purchase order", async () => {
    const res = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendor: fixtures.vendor._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{
          product: fixtures.product._id.toString(),
          quantity: 100,
          unitPrice: 50,
        }],
        remarks: "Test PO",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    poId = res.body.data._id;
  });

  test("CRITICAL: Creating PO must NOT increase inventory", async () => {
    const movementCount = await StockMovement.countDocuments({
      referenceId: poId,
      type: "STOCK_IN",
    });
    expect(movementCount).toBe(0);
  });

  test("GET /api/purchases - should list purchase orders", async () => {
    const res = await request(app)
      .get("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/purchases/:id - should get single PO", async () => {
    const res = await request(app)
      .get(`/api/purchases/${poId}`)
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("PUT /api/purchases/:id/approve - should approve PO", async () => {
    const res = await request(app)
      .put(`/api/purchases/${poId}/approve`)
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("APPROVED");
  });

  test("CRITICAL: Approving PO must NOT increase inventory", async () => {
    const movementCount = await StockMovement.countDocuments({
      referenceId: poId,
      type: "STOCK_IN",
    });
    expect(movementCount).toBe(0);
  });

  test("POST /api/purchases - should reject inactive vendor", async () => {
    const Vendor = require("../../Models/Vendor");
    const inactiveVendor = await Vendor.create({
      vendorName: "Inactive Vendor",
      phone: "1234567891",
      status: "INACTIVE",
    });

    const res = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendor: inactiveVendor._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 10, unitPrice: 50 }],
      });

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/purchases/:id/cancel - should cancel PO", async () => {
    const createRes = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendor: fixtures.vendor._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 10, unitPrice: 50 }],
      });

    const newPoId = createRes.body.data._id;

    const res = await request(app)
      .put(`/api/purchases/${newPoId}/cancel`)
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
  });
});

// ========== GOODS RECEIPT TESTS ==========
describe("Goods Receipt - Inventory Increase", () => {
  let poId;

  beforeAll(async () => {
    const createRes = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendor: fixtures.vendor._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{
          product: fixtures.product._id.toString(),
          quantity: 100,
          unitPrice: 50,
        }],
      });
    poId = createRes.body.data._id;

    await request(app)
      .put(`/api/purchases/${poId}/approve`)
      .set("Authorization", `Bearer ${pmToken}`);

    await Inventory.findOneAndUpdate(
      { product: fixtures.product._id, warehouse: fixtures.warehouse1._id },
      { $set: { quantity: 0, reservedStock: 0 } },
      { upsert: true }
    );
  });

  test("partial goods receipt should increase inventory by received amount", async () => {
    const res = await request(app)
      .put(`/api/purchases/${poId}/receive`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        items: [{ product: fixtures.product._id.toString(), quantity: 40 }],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("PARTIALLY_RECEIVED");

    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.quantity).toBe(40);

    const movements = await StockMovement.find({
      referenceId: poId,
      type: "STOCK_IN",
    });
    expect(movements.length).toBeGreaterThan(0);
  });

  test("second partial receipt should add to inventory", async () => {
    const res = await request(app)
      .put(`/api/purchases/${poId}/receive`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        items: [{ product: fixtures.product._id.toString(), quantity: 60 }],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("RECEIVED");

    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.quantity).toBe(100);
  });

  test("should reject over-receiving", async () => {
    const res = await request(app)
      .put(`/api/purchases/${poId}/receive`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        items: [{ product: fixtures.product._id.toString(), quantity: 1 }],
      });

    expect(res.statusCode).toBe(400);
  });

  test("should reject receiving against cancelled PO", async () => {
    const createRes = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendor: fixtures.vendor._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 10, unitPrice: 50 }],
      });

    await request(app)
      .put(`/api/purchases/${createRes.body.data._id}/cancel`)
      .set("Authorization", `Bearer ${pmToken}`);

    const res = await request(app)
      .put(`/api/purchases/${createRes.body.data._id}/receive`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        items: [{ product: fixtures.product._id.toString(), quantity: 5 }],
      });

    expect(res.statusCode).toBe(400);
  });
});

// ========== GOODS RECEIPT CONTROLLER (Direct) TESTS ==========
describe("Goods Receipt Controller (POST /api/goods-receipts)", () => {
  let grPoId;

  beforeAll(async () => {
    const createRes = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendor: fixtures.vendor._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{
          product: fixtures.product2._id.toString(),
          quantity: 50,
          unitPrice: 25,
        }],
      });
    grPoId = createRes.body.data._id;

    await request(app)
      .put(`/api/purchases/${grPoId}/approve`)
      .set("Authorization", `Bearer ${pmToken}`);
  });

  test("POST /api/goods-receipts - should create goods receipt and increase inventory", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product2._id,
      warehouse: fixtures.warehouse1._id,
    });
    const prevQty = invBefore?.quantity || 0;

    const res = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        purchaseOrder: grPoId,
        items: [{
          product: fixtures.product2._id.toString(),
          receivedQuantity: 30,
          damagedQuantity: 0,
        }],
        remarks: "GRN test",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);

    const invAfter = await Inventory.findOne({
      product: fixtures.product2._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(invAfter.quantity).toBe(prevQty + 30);
  });

  test("GET /api/goods-receipts - should list goods receipts", async () => {
    const res = await request(app)
      .get("/api/goods-receipts")
      .set("Authorization", `Bearer ${whToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

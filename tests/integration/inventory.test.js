/**
 * Integration Tests: Inventory Operations
 * Tests stock-in, stock-out, adjustments, multi-warehouse isolation,
 * negative stock prevention, and available stock calculations.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");

let seedData, whToken, adminToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();
});

describe("Stock In", () => {
  test("should increase inventory and create STOCK_IN movement", async () => {
    // Initial: 0 (no inventory record yet)
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 100,
        remarks: "Initial stock",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quantity).toBe(100);
    expect(res.body.movement).toBeDefined();
    expect(res.body.movement.type).toBe("STOCK_IN");
    expect(res.body.movement.quantity).toBe(100);
    expect(res.body.movement.previousQuantity).toBe(0);
    expect(res.body.movement.newQuantity).toBe(100);
  });

  test("should add to existing stock (100 + 20 = 120)", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 20,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.quantity).toBe(120);
  });

  test("should reject zero quantity", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 0,
      });

    expect(res.statusCode).toBe(400);
  });

  test("should reject negative quantity", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: -10,
      });

    expect(res.statusCode).toBe(400);
  });

  test("should reject invalid product ID", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: "invalid",
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 10,
      });

    expect(res.statusCode).toBe(400);
  });
});

describe("Stock Out", () => {
  test("should decrease inventory (120 - 20 = 100)", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-out")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 20,
        reason: "Test outbound",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.quantity).toBe(100);
    expect(res.body.movement.type).toBe("STOCK_OUT");
  });

  test("should reject stock out exceeding available stock", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-out")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 999,
      });

    expect(res.statusCode).toBe(409);
  });

  test("should prevent negative stock", async () => {
    // Current: 100. Try to take out 101.
    const res = await request(app)
      .post("/api/inventory/stock-out")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 101,
      });

    expect(res.statusCode).toBe(409);
  });
});

describe("Stock Adjustment", () => {
  test("should adjust inventory to target quantity", async () => {
    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });

    const res = await request(app)
      .put(`/api/inventory/${inv._id}/adjust`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({ quantity: 150, reason: "Cycle count" });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.quantity).toBe(150);
    expect(res.body.movement.type).toBe("ADJUSTMENT");
  });

  test("should reject negative target quantity", async () => {
    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });

    const res = await request(app)
      .put(`/api/inventory/${inv._id}/adjust`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({ quantity: -10, reason: "Invalid" });

    expect(res.statusCode).toBe(400);
  });
});

describe("Available Stock Calculation", () => {
  test("availableStock = quantity - reservedStock", async () => {
    // Set up: quantity=100, reservedStock=30
    await Inventory.findOneAndUpdate(
      { product: fixtures.product._id, warehouse: fixtures.warehouse1._id },
      { $set: { quantity: 100, reservedStock: 30 } }
    );

    const res = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${whToken}`)
      .query({ product: fixtures.product._id.toString(), warehouse: fixtures.warehouse1._id.toString() });

    expect(res.statusCode).toBe(200);
    const inv = res.body.data.find(
      (d) => d.product?._id?.toString() === fixtures.product._id.toString()
    );
    expect(inv).toBeDefined();
    expect(inv.availableStock).toBe(70);
  });
});

describe("Multi-Warehouse Inventory Isolation", () => {
  beforeAll(async () => {
    // Setup: Product in warehouse1=100, warehouse2=50
    await Inventory.findOneAndUpdate(
      { product: fixtures.product._id, warehouse: fixtures.warehouse1._id },
      { $set: { quantity: 100, reservedStock: 0 } },
      { upsert: true }
    );
    await Inventory.findOneAndUpdate(
      { product: fixtures.product._id, warehouse: fixtures.warehouse2._id },
      { $set: { quantity: 50, reservedStock: 0 } },
      { upsert: true }
    );
  });

  test("updating warehouse1 must NOT modify warehouse2", async () => {
    await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        quantity: 10,
      });

    // Warehouse1 should be 110
    const wh1 = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(wh1.quantity).toBe(110);

    // Warehouse2 should remain 50
    const wh2 = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse2._id,
    });
    expect(wh2.quantity).toBe(50);
  });

  test("stock out from one warehouse does not affect other", async () => {
    await request(app)
      .post("/api/inventory/stock-out")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: fixtures.warehouse2._id.toString(),
        quantity: 10,
      });

    const wh1 = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(wh1.quantity).toBe(110);

    const wh2 = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse2._id,
    });
    expect(wh2.quantity).toBe(40);
  });

  test("GET /api/inventory/warehouse/:warehouseId - should return warehouse-specific inventory", async () => {
    const res = await request(app)
      .get(`/api/inventory/warehouse/${fixtures.warehouse1._id}`)
      .set("Authorization", `Bearer ${whToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.warehouse.name).toBeDefined();
  });
});

describe("Stock Movement Verification", () => {
  test("each inventory operation should generate corresponding StockMovement", async () => {
    const movements = await StockMovement.find({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    }).sort({ createdAt: -1 });

    expect(movements.length).toBeGreaterThan(0);

    for (const m of movements) {
      expect(m.product.toString()).toBe(fixtures.product._id.toString());
      expect(m.warehouse.toString()).toBe(fixtures.warehouse1._id.toString());
      expect(m.quantity).toBeGreaterThan(0);
      expect(m.previousQuantity).toBeDefined();
      expect(m.newQuantity).toBeDefined();
      expect(["STOCK_IN", "STOCK_OUT", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT", "RETURN_IN", "DAMAGED"]).toContain(m.type);
    }
  });
});

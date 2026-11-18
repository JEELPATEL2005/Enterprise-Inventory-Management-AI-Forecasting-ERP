/**
 * Integration Tests: Sales Order, Reserve, Fulfill, Cancel, Invoice
 * Tests the full sales lifecycle and critical business rules:
 * - Creating SO does NOT reduce inventory
 * - Reserving updates reservedStock
 * - Fulfilling atomically reduces physical inventory
 * - Cancel releases reservations
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");
const { createTestInventory } = helpers;

let seedData, smToken, adminToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  smToken = helpers.getTokenForRole("SALES_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();
});

describe("Sales Order API", () => {
  let soId;

  beforeAll(async () => {
    // Set up initial inventory: 200 units, 0 reserved
    await createTestInventory(
      fixtures.product._id,
      fixtures.warehouse1._id,
      200,
      0
    );
  });

  test("POST /api/sales-orders - should create sales order", async () => {
    const res = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{
          product: fixtures.product._id.toString(),
          quantity: 50,
          unitPrice: 100,
        }],
        remarks: "Test SO",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("PENDING");
    soId = res.body.data._id;
  });

  test("CRITICAL: Creating SO must NOT reduce physical inventory", async () => {
    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.quantity).toBe(200);
    expect(inv.reservedStock).toBe(0);
  });

  test("GET /api/sales-orders - should list sales orders", async () => {
    const res = await request(app)
      .get("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/sales-orders/:id - should get single SO", async () => {
    const res = await request(app)
      .get(`/api/sales-orders/${soId}`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data._id).toBe(soId);
  });

  test("POST /api/sales-orders - should reject inactive customer", async () => {
    const Customer = require("../../Models/Customer");
    const inactive = await Customer.create({
      customerName: "Inactive Cust",
      phone: "1234567892",
      status: "INACTIVE",
    });

    const res = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: inactive._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 5, unitPrice: 100 }],
      });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/sales-orders - should reject missing required fields", async () => {
    const res = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({});

    expect(res.statusCode).toBe(400);
  });
});

describe("Sales Order Reserve", () => {
  let soId;

  beforeAll(async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 200, 0);

    const res = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 30, unitPrice: 100 }],
      });
    soId = res.body.data._id;
  });

  test("PUT /api/sales-orders/:id/reserve - should reserve stock", async () => {
    const res = await request(app)
      .put(`/api/sales-orders/${soId}/reserve`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("RESERVED");

    // Verify reservedStock increased
    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.reservedStock).toBe(30);
    // Physical quantity must NOT change from reservation
    expect(inv.quantity).toBe(200);
    // Available = 200 - 30 = 170
    expect(inv.availableStock).toBe(170);
  });

  test("should reject duplicate reservation", async () => {
    const res = await request(app)
      .put(`/api/sales-orders/${soId}/reserve`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(400);
  });

  test("should reject reservation with insufficient stock", async () => {
    await createTestInventory(fixtures.product2._id, fixtures.warehouse1._id, 10, 0);

    const createRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product2._id.toString(), quantity: 9999, unitPrice: 100 }],
      });

    const res = await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/reserve`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(409);
  });
});

describe("Sales Order Fulfill", () => {
  let soId;

  beforeAll(async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 200, 0);

    // Create and reserve
    const res = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 50, unitPrice: 100 }],
      });
    soId = res.body.data._id;

    await request(app)
      .put(`/api/sales-orders/${soId}/reserve`)
      .set("Authorization", `Bearer ${smToken}`);
  });

  test("PUT /api/sales-orders/:id/fulfill - should deduct physical inventory", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    const qtyBefore = invBefore.quantity;

    const res = await request(app)
      .put(`/api/sales-orders/${soId}/fulfill`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("FULFILLED");

    const invAfter = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });

    // Physical quantity decreased by fulfilled amount
    expect(invAfter.quantity).toBe(qtyBefore - 50);
    // Reserved stock also decreased
    expect(invAfter.reservedStock).toBe(invBefore.reservedStock - 50);

    // STOCK_OUT movement created
    const movement = await StockMovement.findOne({
      referenceId: soId,
      type: "STOCK_OUT",
      referenceType: "SALE",
    });
    expect(movement).not.toBeNull();
    expect(movement.quantity).toBe(50);
  });

  test("should reject re-fulfillment", async () => {
    const res = await request(app)
      .put(`/api/sales-orders/${soId}/fulfill`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(400);
  });

  test("should reject fulfillment without reservation", async () => {
    const createRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 5, unitPrice: 100 }],
      });

    const res = await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/fulfill`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(400);
  });
});

describe("Sales Order Cancel", () => {
  test("cancel PENDING order should succeed without inventory change", async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 200, 0);

    const createRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 10, unitPrice: 100 }],
      });

    const res = await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/cancel`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");

    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.quantity).toBe(200);
    expect(inv.reservedStock).toBe(0);
  });

  test("cancel RESERVED order should release reserved stock", async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 200, 0);

    // Create and reserve
    const createRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 25, unitPrice: 100 }],
      });

    await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/reserve`)
      .set("Authorization", `Bearer ${smToken}`);

    // Verify reservation
    let inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.reservedStock).toBe(25);

    // Cancel
    const cancelRes = await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/cancel`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.body.data.status).toBe("CANCELLED");

    // Verify reservation released
    inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.reservedStock).toBe(0);
    expect(inv.quantity).toBe(200);
  });

  test("should reject cancelling a fulfilled order", async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 200, 0);

    const createRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 5, unitPrice: 100 }],
      });

    await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/reserve`)
      .set("Authorization", `Bearer ${smToken}`);

    await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/fulfill`)
      .set("Authorization", `Bearer ${smToken}`);

    const cancelRes = await request(app)
      .put(`/api/sales-orders/${createRes.body.data._id}/cancel`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(cancelRes.statusCode).toBe(400);
  });
});

describe("Sales Order Invoice", () => {
  let soId;

  beforeAll(async () => {
    const res = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 5, unitPrice: 100 }],
      });
    soId = res.body.data._id;
  });

  test("POST /api/sales-orders/:id/invoice - should generate invoice", async () => {
    const res = await request(app)
      .post(`/api/sales-orders/${soId}/invoice`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.invoiceNumber).toBeDefined();
    expect(res.body.data.totalAmount).toBeDefined();
  });

  test("should return existing invoice if already exists", async () => {
    const res = await request(app)
      .post(`/api/sales-orders/${soId}/invoice`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.alreadyExisted).toBe(true);
  });
});

describe("Sales Order Availability Check", () => {
  test("GET /api/sales-orders/:id/availability - should check stock availability", async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 200, 50);

    const createRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 100, unitPrice: 100 }],
      });

    const res = await request(app)
      .get(`/api/sales-orders/${createRes.body.data._id}/availability`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items[0].availableStock).toBe(150); // 200 - 50
  });
});

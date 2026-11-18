/**
 * Integration Tests: Invoice, Delivery, and Return Workflows
 * Tests Sections 20, 21, and 22:
 * 1. Invoice: Creation, get, duplicate prevention, invalid data, inventory unchanged
 * 2. Delivery: Creation, assignment, status transitions, invalid status rejection, inventory unchanged
 * 3. Returns: Good product (inventory +10, RETURN_IN), Damaged product (sellable inventory unchanged, DAMAGED movement)
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");
const SalesOrder = require("../../Models/SalesOrder");
const Invoice = require("../../Models/Invoice");
const Delivery = require("../../Models/Delivery");
const Return = require("../../Models/Return");
const { createTestInventory } = helpers;

let seedData, smToken, adminToken, whToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  smToken = helpers.getTokenForRole("SALES_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  fixtures = await helpers.createTestFixtures();
});

// Helper to create and fulfill an order for downstream delivery and returns
async function createAndFulfillOrder(qty = 20) {
  await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 200, 0);

  const orderRes = await request(app)
    .post("/api/sales-orders")
    .set("Authorization", `Bearer ${smToken}`)
    .send({
      customer: fixtures.customer._id.toString(),
      warehouse: fixtures.warehouse1._id.toString(),
      items: [{ product: fixtures.product._id.toString(), quantity: qty, unitPrice: 100 }],
    });

  const orderId = orderRes.body.data._id;

  await request(app)
    .put(`/api/sales-orders/${orderId}/reserve`)
    .set("Authorization", `Bearer ${smToken}`);

  await request(app)
    .put(`/api/sales-orders/${orderId}/fulfill`)
    .set("Authorization", `Bearer ${smToken}`);

  return orderId;
}

// ========== INVOICE TESTS ==========
describe("Invoice API (Section 20)", () => {
  let fulfilledOrderId;
  let createdInvoiceId;

  beforeAll(async () => {
    fulfilledOrderId = await createAndFulfillOrder(15);
  });

  test("POST /api/invoices - should create invoice from sales order", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    const qtyBefore = invBefore.quantity;

    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrderId: fulfilledOrderId,
        taxAmount: 150,
        discountAmount: 50,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.invoiceNumber).toBeDefined();
    expect(res.body.data.subtotal).toBe(1500); // 15 * 100
    expect(res.body.data.totalAmount).toBe(1600); // 1500 + 150 - 50
    createdInvoiceId = res.body.data._id;

    // CRITICAL: Creating invoice must NOT independently decrease physical inventory
    const invAfter = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(invAfter.quantity).toBe(qtyBefore);
  });

  test("GET /api/invoices - should list invoices", async () => {
    const res = await request(app)
      .get("/api/invoices")
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/invoices/:id - should get single invoice", async () => {
    const res = await request(app)
      .get(`/api/invoices/${createdInvoiceId}`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data._id).toBe(createdInvoiceId);
  });

  test("POST /api/invoices - should reject duplicate invoice for same sales order", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrderId: fulfilledOrderId,
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/already exists/i);
  });

  test("POST /api/invoices - should reject missing sales order", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${smToken}`)
      .send({});

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/invoices - should reject non-existent sales order", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrderId: new mongoose.Types.ObjectId().toString(),
      });

    expect(res.statusCode).toBe(404);
  });
});

// ========== DELIVERY TESTS ==========
describe("Delivery API (Section 21)", () => {
  let deliveryOrderId;
  let createdDeliveryId;

  beforeAll(async () => {
    deliveryOrderId = await createAndFulfillOrder(10);
  });

  test("POST /api/deliveries - should create delivery for order", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    const qtyBefore = invBefore.quantity;

    const res = await request(app)
      .post("/api/deliveries")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrder: deliveryOrderId,
        deliveryAddress: "456 Deliver Lane",
        recipientContact: "9876543210",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("PENDING");
    createdDeliveryId = res.body.data._id;

    // Delivery creation must not change inventory
    const invAfter = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(invAfter.quantity).toBe(qtyBefore);
  });

  test("PUT /api/deliveries/:id/assign - should assign employee to delivery", async () => {
    const res = await request(app)
      .put(`/api/deliveries/${createdDeliveryId}/assign`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        assignedEmployee: seedData.employeeMap.WAREHOUSE_MANAGER._id.toString(),
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("ASSIGNED");
    expect(res.body.data.assignedEmployee).toBeDefined();
  });

  test("PUT /api/deliveries/:id/status - should transition to IN_TRANSIT", async () => {
    const res = await request(app)
      .put(`/api/deliveries/${createdDeliveryId}/status`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        status: "IN_TRANSIT",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("IN_TRANSIT");
  });

  test("PUT /api/deliveries/:id/status - should transition to DELIVERED", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });

    const res = await request(app)
      .put(`/api/deliveries/${createdDeliveryId}/status`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        status: "DELIVERED",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("DELIVERED");

    // CRITICAL: Delivery status changes must NOT independently decrease physical inventory
    const invAfter = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(invAfter.quantity).toBe(invBefore.quantity);
  });

  test("PUT /api/deliveries/:id/status - should reject invalid status", async () => {
    const res = await request(app)
      .put(`/api/deliveries/${createdDeliveryId}/status`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        status: "TELEPORTED",
      });

    expect(res.statusCode).toBe(400);
  });
});

// ========== RETURN TESTS ==========
describe("Return API (Section 22)", () => {
  let returnOrderId;

  beforeAll(async () => {
    returnOrderId = await createAndFulfillOrder(20);
  });

  test("Good Product Return: Returned quantity = 10, Condition = GOOD -> Inventory +10, StockMovement = RETURN_IN", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    const prevQty = invBefore.quantity;

    // 1. Create Return Request
    const createRes = await request(app)
      .post("/api/returns")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrder: returnOrderId,
        items: [{
          product: fixtures.product._id.toString(),
          quantity: 10,
          condition: "GOOD",
          reason: "Customer ordered wrong size",
        }],
        reason: "Customer exchange",
      });

    expect(createRes.statusCode).toBe(201);
    expect(createRes.body.success).toBe(true);
    const returnId = createRes.body.data._id;

    // 2. Approve Return
    const approveRes = await request(app)
      .put(`/api/returns/${returnId}/status`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({ status: "APPROVED" });
    expect(approveRes.statusCode).toBe(200);

    // 3. Inspect Return (record condition as GOOD)
    const inspectRes = await request(app)
      .put(`/api/returns/${returnId}/inspect`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        items: [{ product: fixtures.product._id.toString(), condition: "GOOD" }],
      });
    expect(inspectRes.statusCode).toBe(200);

    // 4. Complete Return & Restock
    const completeRes = await request(app)
      .put(`/api/returns/${returnId}/complete`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.body.data.status).toBe("COMPLETED");

    // 5. Verify physical inventory increased by 10
    const invAfter = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(invAfter.quantity).toBe(prevQty + 10);

    // 6. Verify StockMovement created with type RETURN_IN
    const movement = await StockMovement.findOne({
      referenceId: returnId,
      type: "RETURN_IN",
    });
    expect(movement).not.toBeNull();
    expect(movement.quantity).toBe(10);
    expect(movement.previousQuantity).toBe(prevQty);
    expect(movement.newQuantity).toBe(prevQty + 10);
  });

  test("Damaged Product Return: Condition = DAMAGED -> Sellable inventory does NOT increase", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    const sellableBefore = invBefore.quantity;
    const damagedBefore = invBefore.damagedStock || 0;

    // 1. Create Return Request for remaining 10 units
    const createRes = await request(app)
      .post("/api/returns")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrder: returnOrderId,
        items: [{
          product: fixtures.product._id.toString(),
          quantity: 5,
          condition: "DAMAGED",
          reason: "Item arrived broken",
        }],
        reason: "Damaged in transit",
      });

    expect(createRes.statusCode).toBe(201);
    const returnId = createRes.body.data._id;

    // 2. Approve
    await request(app)
      .put(`/api/returns/${returnId}/status`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({ status: "APPROVED" });

    // 3. Inspect as DAMAGED
    await request(app)
      .put(`/api/returns/${returnId}/inspect`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        items: [{ product: fixtures.product._id.toString(), condition: "DAMAGED" }],
      });

    // 4. Complete Return
    const completeRes = await request(app)
      .put(`/api/returns/${returnId}/complete`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(completeRes.statusCode).toBe(200);

    // 5. CRITICAL: Sellable inventory must NOT increase
    const invAfter = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(invAfter.quantity).toBe(sellableBefore); // unchanged!
    expect(invAfter.damagedStock).toBe(damagedBefore + 5);

    // 6. Verify movement has type DAMAGED
    const movement = await StockMovement.findOne({
      referenceId: returnId,
      type: "DAMAGED",
    });
    expect(movement).not.toBeNull();
    expect(movement.quantity).toBe(5);
  });

  test("should reject over-returning items beyond order quantity", async () => {
    // Only 20 units were sold; 10 GOOD + 5 DAMAGED = 15 already returned
    // Attempting to return 10 more (15 + 10 = 25 > 20) must be rejected
    const res = await request(app)
      .post("/api/returns")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrder: returnOrderId,
        items: [{ product: fixtures.product._id.toString(), quantity: 10, reason: "Excess" }],
        reason: "Excess return",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/cannot return/i);
  });

  test("should reject completing an already completed return", async () => {
    const listRes = await request(app)
      .get("/api/returns")
      .set("Authorization", `Bearer ${smToken}`)
      .query({ status: "COMPLETED" });

    const completed = listRes.body.data[0];
    if (completed) {
      const res = await request(app)
        .put(`/api/returns/${completed._id}/complete`)
        .set("Authorization", `Bearer ${smToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/already been completed/i);
    }
  });
});

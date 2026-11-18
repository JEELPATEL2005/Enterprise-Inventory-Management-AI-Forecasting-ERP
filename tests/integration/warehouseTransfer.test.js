/**
 * Integration Tests: Warehouse Transfer
 * Tests Section 16:
 * - Source Warehouse -> Transfer -> Destination Warehouse
 * - Example: Ahmedabad = 100, Surat = 30, Transfer = 20 -> Ahmedabad = 80, Surat = 50
 * - TRANSFER_OUT and TRANSFER_IN movements
 * - MongoDB transactions and rollback testing
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");
const StockTransfer = require("../../Models/StockTransfer");
const { createTestInventory } = helpers;

let seedData, whToken, adminToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();
});

describe("Warehouse Transfer Workflow", () => {
  let transferId;

  beforeEach(async () => {
    // Setup exact numbers from prompt:
    // Ahmedabad (warehouse1) = 100
    // Surat (warehouse2) = 30
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 100, 0);
    await createTestInventory(fixtures.product._id, fixtures.warehouse2._id, 30, 0);
  });

  test("POST /api/stock-transfers - should create transfer request", async () => {
    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        sourceWarehouse: fixtures.warehouse1._id.toString(),
        destinationWarehouse: fixtures.warehouse2._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 20 }],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("REQUESTED");
    transferId = res.body.data._id;
  });

  test("PUT /api/stock-transfers/:id/approve - should approve transfer", async () => {
    // Create new transfer to approve
    const createRes = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        sourceWarehouse: fixtures.warehouse1._id.toString(),
        destinationWarehouse: fixtures.warehouse2._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 20 }],
      });

    const res = await request(app)
      .put(`/api/stock-transfers/${createRes.body.data._id}/approve`)
      .set("Authorization", `Bearer ${whToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("APPROVED");
  });

  test("PUT /api/stock-transfers/:id/dispatch - should dispatch transfer", async () => {
    const createRes = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        sourceWarehouse: fixtures.warehouse1._id.toString(),
        destinationWarehouse: fixtures.warehouse2._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 20 }],
      });

    await request(app)
      .put(`/api/stock-transfers/${createRes.body.data._id}/approve`)
      .set("Authorization", `Bearer ${whToken}`);

    const res = await request(app)
      .put(`/api/stock-transfers/${createRes.body.data._id}/dispatch`)
      .set("Authorization", `Bearer ${whToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("IN_TRANSIT");
  });

  test("PUT /api/stock-transfers/:id/complete - Ahmedabad=100 -> 80, Surat=30 -> 50", async () => {
    // Create, approve, dispatch, complete
    const createRes = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        sourceWarehouse: fixtures.warehouse1._id.toString(),
        destinationWarehouse: fixtures.warehouse2._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 20 }],
      });

    const currentId = createRes.body.data._id;

    await request(app)
      .put(`/api/stock-transfers/${currentId}/approve`)
      .set("Authorization", `Bearer ${whToken}`);

    await request(app)
      .put(`/api/stock-transfers/${currentId}/dispatch`)
      .set("Authorization", `Bearer ${whToken}`);

    const res = await request(app)
      .put(`/api/stock-transfers/${currentId}/complete`)
      .set("Authorization", `Bearer ${whToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify source inventory: 100 - 20 = 80
    const srcInv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(srcInv.quantity).toBe(80);

    // Verify destination inventory: 30 + 20 = 50
    const dstInv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse2._id,
    });
    expect(dstInv.quantity).toBe(50);

    // Verify TRANSFER_OUT stock movement
    const moveOut = await StockMovement.findOne({
      referenceId: currentId,
      type: "TRANSFER_OUT",
    });
    expect(moveOut).not.toBeNull();
    expect(moveOut.quantity).toBe(20);
    expect(moveOut.previousQuantity).toBe(100);
    expect(moveOut.newQuantity).toBe(80);

    // Verify TRANSFER_IN stock movement
    const moveIn = await StockMovement.findOne({
      referenceId: currentId,
      type: "TRANSFER_IN",
    });
    expect(moveIn).not.toBeNull();
    expect(moveIn.quantity).toBe(20);
    expect(moveIn.previousQuantity).toBe(30);
    expect(moveIn.newQuantity).toBe(50);
  });

  test("should reject transfer when source and destination warehouse are identical", async () => {
    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        sourceWarehouse: fixtures.warehouse1._id.toString(),
        destinationWarehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 10 }],
      });

    expect(res.statusCode).toBe(400);
  });

  test("should reject transfer when source stock is insufficient", async () => {
    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        sourceWarehouse: fixtures.warehouse1._id.toString(),
        destinationWarehouse: fixtures.warehouse2._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 99999 }],
      });

    // Created as requested, but approval must fail due to insufficient stock
    const approveRes = await request(app)
      .put(`/api/stock-transfers/${res.body.data._id}/approve`)
      .set("Authorization", `Bearer ${whToken}`);

    expect(approveRes.statusCode).toBe(409);
  });
});

describe("Warehouse Transfer - Transaction Rollback", () => {
  test("transaction rollback: if operation fails, source inventory remains unchanged", async () => {
    // Source WH1 has 50 units
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 50, 0);
    await createTestInventory(fixtures.product._id, fixtures.warehouse2._id, 10, 0);

    const createRes = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        sourceWarehouse: fixtures.warehouse1._id.toString(),
        destinationWarehouse: fixtures.warehouse2._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 30 }],
      });

    const transfer = createRes.body.data;

    await request(app)
      .put(`/api/stock-transfers/${transfer._id}/approve`)
      .set("Authorization", `Bearer ${whToken}`);

    // Now deplete source stock behind the scenes so completion fails mid-transaction!
    await Inventory.findOneAndUpdate(
      { product: fixtures.product._id, warehouse: fixtures.warehouse1._id },
      { $set: { quantity: 10 } } // Less than 30 required
    );

    const res = await request(app)
      .put(`/api/stock-transfers/${transfer._id}/complete`)
      .set("Authorization", `Bearer ${whToken}`);

    expect(res.statusCode).toBe(409);

    // Source must still have 10 (not decremented to negative or partially modified)
    const srcInv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(srcInv.quantity).toBe(10);

    // Destination must still have 10 (not increased)
    const dstInv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse2._id,
    });
    expect(dstInv.quantity).toBe(10);

    // No completed stock movements should exist
    const movements = await StockMovement.find({
      referenceId: transfer._id,
    });
    expect(movements.length).toBe(0);
  });
});

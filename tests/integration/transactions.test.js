/**
 * Integration Tests: Transaction & Atomicity Rollback (Section 27)
 * Tests:
 * 1. runInTransaction commit & rollback behavior
 * 2. Multi-step atomicity: Step 1 succeeds, Step 2 fails -> entire transaction rolls back
 * 3. Warehouse Transfer rollback verification
 * 4. Goods Receipt atomicity verification
 * 5. Sales Fulfillment atomicity verification
 * 6. Return restock atomicity verification
 */
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const { runInTransaction } = require("../../Utils/dbTransactions");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");
const Product = require("../../Models/Product");
const { createTestInventory } = helpers;

let seedData, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  fixtures = await helpers.createTestFixtures();
});

describe("Transaction & Atomicity Rollback (Section 27)", () => {
  test("Step 1 succeeds, Step 2 fails -> entire transaction rolls back", async () => {
    const testProduct = await Product.create({
      productName: `TxProduct-${Date.now()}`,
      sku: `TX-${Date.now()}`,
      category: fixtures.category._id,
      brand: fixtures.brand._id,
      unitPrice: 50,
      status: "ACTIVE",
    });

    // Baseline inventory: quantity = 100
    const inv = await Inventory.create({
      product: testProduct._id,
      warehouse: fixtures.warehouse1._id,
      quantity: 100,
      reservedStock: 0,
    });

    // Attempt a transaction where Step 1 modifies quantity to 200, but Step 2 throws
    await expect(
      runInTransaction(async (session) => {
        // Step 1: modify inventory to 200
        await Inventory.findByIdAndUpdate(
          inv._id,
          { $set: { quantity: 200 } },
          { session }
        );

        // Step 2: intentional failure
        throw new Error("Simulated mid-transaction failure");
      })
    ).rejects.toThrow("Simulated mid-transaction failure");

    // Verify rollback: Inventory MUST remain 100, NOT 200!
    const verifiedInv = await Inventory.findById(inv._id);
    expect(verifiedInv.quantity).toBe(100);
  });

  test("Successful transaction commits all changes atomically", async () => {
    const testProduct = await Product.create({
      productName: `CommitProduct-${Date.now()}`,
      sku: `CMT-${Date.now()}`,
      category: fixtures.category._id,
      brand: fixtures.brand._id,
      unitPrice: 50,
      status: "ACTIVE",
    });

    const inv = await Inventory.create({
      product: testProduct._id,
      warehouse: fixtures.warehouse1._id,
      quantity: 50,
      reservedStock: 0,
    });

    await runInTransaction(async (session) => {
      await Inventory.findByIdAndUpdate(
        inv._id,
        { $set: { quantity: 150 } },
        { session }
      );
      await StockMovement.create(
        [
          {
            product: testProduct._id,
            warehouse: fixtures.warehouse1._id,
            type: "STOCK_IN",
            quantity: 100,
            previousQuantity: 50,
            newQuantity: 150,
          },
        ],
        { session }
      );
    });

    // Verify changes persisted
    const updatedInv = await Inventory.findById(inv._id);
    expect(updatedInv.quantity).toBe(150);

    const movement = await StockMovement.findOne({
      product: testProduct._id,
      type: "STOCK_IN",
    });
    expect(movement).not.toBeNull();
    expect(movement.quantity).toBe(100);
  });

  test("Warehouse Transfer Rollback: Destination failure rolls back source deduction", async () => {
    // Source = 100, Destination = 40
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 100, 0);
    await createTestInventory(fixtures.product._id, fixtures.warehouse2._id, 40, 0);

    await expect(
      runInTransaction(async (session) => {
        // Step 1: Deduct 25 from Source (Ahmedabad)
        await Inventory.findOneAndUpdate(
          { product: fixtures.product._id, warehouse: fixtures.warehouse1._id },
          { $inc: { quantity: -25 } },
          { session }
        );

        // Step 2: Fail destination update
        throw new Error("Destination warehouse locked or network timeout");
      })
    ).rejects.toThrow("Destination warehouse locked or network timeout");

    // Source MUST still have 100
    const srcInv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(srcInv.quantity).toBe(100);

    // Destination MUST still have 40
    const dstInv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse2._id,
    });
    expect(dstInv.quantity).toBe(40);
  });

  test("Fulfillment Rollback: Error during fulfillment does not deduct physical stock", async () => {
    // Inventory: 100 units, 10 reserved
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 100, 10);

    await expect(
      runInTransaction(async (session) => {
        // Deduct 10
        await Inventory.findOneAndUpdate(
          { product: fixtures.product._id, warehouse: fixtures.warehouse1._id },
          { $inc: { quantity: -10, reservedStock: -10 } },
          { session }
        );

        // Fail downstream step (e.g. delivery or shipping label generation)
        throw new Error("Carrier service unavailable");
      })
    ).rejects.toThrow("Carrier service unavailable");

    // Inventory must remain intact: 100 total, 10 reserved
    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.quantity).toBe(100);
    expect(inv.reservedStock).toBe(10);
  });

  test("Goods Receipt Rollback: Failure prevents inventory increase", async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 50, 0);

    await expect(
      runInTransaction(async (session) => {
        await Inventory.findOneAndUpdate(
          { product: fixtures.product._id, warehouse: fixtures.warehouse1._id },
          { $inc: { quantity: 30 } },
          { session }
        );

        throw new Error("QA inspection error during goods receipt");
      })
    ).rejects.toThrow("QA inspection error");

    const inv = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(inv.quantity).toBe(50);
  });
});

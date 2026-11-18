/**
 * Integration Tests: Scheduled Automation & Cron Jobs (Section 26)
 * Tests:
 * 1. Low-stock detection:
 *    - availableStock = 5, reorderPoint = 10 -> Purchase Request created
 *    - availableStock = 50, reorderPoint = 10 -> No Purchase Request created
 * 2. Idempotency:
 *    - Running the low-stock job multiple times must NOT create duplicate active Purchase Requests
 * 3. Overdue Purchase Order detection:
 *    - Flags POs with expectedDate in the past
 */
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const Product = require("../../Models/Product");
const PurchaseRequest = require("../../Models/PurchaseRequest");
const PurchaseOrder = require("../../Models/PurchaseOrder");
const { runLowStockScan, runOverduePurchaseScan } = require("../../jobs/inventoryJobs");
const { createTestInventory } = helpers;

let seedData, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  fixtures = await helpers.createTestFixtures();
});

beforeEach(async () => {
  // Clean up any existing auto-generated purchase requests
  await PurchaseRequest.deleteMany({ reason: "LOW_STOCK" });
});

describe("Low-Stock Automated Cron Job (runLowStockScan)", () => {
  test("creates Purchase Request when availableStock (5) <= reorderPoint (10)", async () => {
    // Setup: product with reorderPoint = 10
    const lowStockProduct = await Product.create({
      productName: `LowStockProd-${Date.now()}`,
      sku: `LSP-${Date.now()}`,
      category: fixtures.category._id,
      brand: fixtures.brand._id,
      unitPrice: 100,
      reorderPoint: 10,
      status: "ACTIVE",
    });

    // Inventory: quantity = 5, reserved = 0 -> availableStock = 5
    await Inventory.create({
      product: lowStockProduct._id,
      warehouse: fixtures.warehouse1._id,
      quantity: 5,
      reservedStock: 0,
      reorderPoint: 10,
    });

    const result = await runLowStockScan();
    expect(result.success).toBe(true);
    expect(result.createdCount).toBeGreaterThanOrEqual(1);

    // Verify PurchaseRequest was created for this product
    const pr = await PurchaseRequest.findOne({
      warehouse: fixtures.warehouse1._id,
      "items.product": lowStockProduct._id,
      status: "PENDING",
    });

    expect(pr).not.toBeNull();
    expect(pr.reason).toBe("LOW_STOCK");
    expect(pr.items[0].quantity).toBeGreaterThanOrEqual(20);
  });

  test("does NOT create Purchase Request when availableStock (50) > reorderPoint (10)", async () => {
    const highStockProduct = await Product.create({
      productName: `HighStockProd-${Date.now()}`,
      sku: `HSP-${Date.now()}`,
      category: fixtures.category._id,
      brand: fixtures.brand._id,
      unitPrice: 100,
      reorderPoint: 10,
      status: "ACTIVE",
    });

    // Inventory: quantity = 50, reserved = 0 -> availableStock = 50
    await Inventory.create({
      product: highStockProduct._id,
      warehouse: fixtures.warehouse1._id,
      quantity: 50,
      reservedStock: 0,
      reorderPoint: 10,
    });

    await runLowStockScan();

    const pr = await PurchaseRequest.findOne({
      warehouse: fixtures.warehouse1._id,
      "items.product": highStockProduct._id,
    });

    expect(pr).toBeNull();
  });

  test("IDEMPOTENCY: running job multiple times must NOT create duplicate active Purchase Requests", async () => {
    const idemProduct = await Product.create({
      productName: `IdemProd-${Date.now()}`,
      sku: `IDEM-${Date.now()}`,
      category: fixtures.category._id,
      brand: fixtures.brand._id,
      unitPrice: 100,
      reorderPoint: 15,
      status: "ACTIVE",
    });

    // availableStock = 5 <= 15
    await Inventory.create({
      product: idemProduct._id,
      warehouse: fixtures.warehouse1._id,
      quantity: 5,
      reservedStock: 0,
      reorderPoint: 15,
    });

    // First scan creates 1 PR
    const res1 = await runLowStockScan();
    expect(res1.success).toBe(true);

    const countAfterFirst = await PurchaseRequest.countDocuments({
      warehouse: fixtures.warehouse1._id,
      "items.product": idemProduct._id,
      status: { $in: ["PENDING", "APPROVED"] },
    });
    expect(countAfterFirst).toBe(1);

    // Second scan: MUST NOT create another PR for the same product and warehouse!
    const res2 = await runLowStockScan();
    expect(res2.success).toBe(true);

    const countAfterSecond = await PurchaseRequest.countDocuments({
      warehouse: fixtures.warehouse1._id,
      "items.product": idemProduct._id,
      status: { $in: ["PENDING", "APPROVED"] },
    });
    expect(countAfterSecond).toBe(1); // Still exactly 1!
  });
});

describe("Overdue Purchase Order Detection (runOverduePurchaseScan)", () => {
  test("detects and flags purchase orders where expectedDate < today", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago

    const overduePO = await PurchaseOrder.create({
      purchaseOrderNumber: `PO-OVERDUE-${Date.now()}`,
      vendor: fixtures.vendor._id,
      warehouse: fixtures.warehouse1._id,
      expectedDate: pastDate,
      status: "ORDERED",
      items: [{
        product: fixtures.product._id,
        quantity: 50,
        unitPrice: 20,
      }],
      subtotal: 1000,
      totalAmount: 1000,
    });

    const result = await runOverduePurchaseScan();
    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);

    const updated = await PurchaseOrder.findById(overduePO._id);
    expect(updated.isOverdue).toBe(true);
  });

  test("does NOT flag purchase orders with future expectedDate", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10); // 10 days in future

    const futurePO = await PurchaseOrder.create({
      purchaseOrderNumber: `PO-FUTURE-${Date.now()}`,
      vendor: fixtures.vendor._id,
      warehouse: fixtures.warehouse1._id,
      expectedDate: futureDate,
      status: "ORDERED",
      items: [{
        product: fixtures.product._id,
        quantity: 50,
        unitPrice: 20,
      }],
      subtotal: 1000,
      totalAmount: 1000,
    });

    await runOverduePurchaseScan();

    const check = await PurchaseOrder.findById(futurePO._id);
    expect(check.isOverdue).toBeFalsy();
  });
});

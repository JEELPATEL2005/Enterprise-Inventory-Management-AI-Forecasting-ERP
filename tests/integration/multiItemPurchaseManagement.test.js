const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");
const PurchaseRequest = require("../../Models/PurchaseRequest");
const PurchaseOrder = require("../../Models/PurchaseOrder");
const GoodsReceipt = require("../../Models/GoodsReceipt");
const Product = require("../../Models/Product");
const Vendor = require("../../Models/Vendor");

let seedData, whToken, purchaseToken, adminToken, fixtures;
let prodLaptop, prodKeyboard, prodMouse, vendorB;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  purchaseToken = helpers.getTokenForRole("PURCHASE_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();

  // Create additional products for multi-item PR testing
  prodLaptop = await Product.create({
    productName: "Dell XPS Laptop",
    sku: `LAPTOP-${Date.now()}`,
    category: fixtures.category._id,
    brand: fixtures.brand._id,
    unitPrice: 1200,
    costPrice: 900,
    unit: "PCS",
    status: "ACTIVE",
  });

  prodKeyboard = await Product.create({
    productName: "Mechanical Keyboard",
    sku: `KEYBOARD-${Date.now()}`,
    category: fixtures.category._id,
    brand: fixtures.brand._id,
    unitPrice: 100,
    costPrice: 60,
    unit: "PCS",
    status: "ACTIVE",
  });

  prodMouse = await Product.create({
    productName: "Wireless Mouse",
    sku: `MOUSE-${Date.now()}`,
    category: fixtures.category._id,
    brand: fixtures.brand._id,
    unitPrice: 40,
    costPrice: 20,
    unit: "PCS",
    status: "ACTIVE",
  });

  vendorB = await Vendor.create({
    vendorName: "Second Vendor Logistics",
    phone: "9123456780",
    email: "vendorB@test.com",
    address: "789 Industrial Park",
    status: "ACTIVE",
  });
});

describe("Module 1: Multi-Item Purchase Management Lifecycle", () => {
  let prId, laptopPrItemId, keyboardPrItemId, mousePrItemId;
  let po1Id, po2Id;

  test("Step 1: Warehouse Manager creates a multi-item PR with 3 products", async () => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        warehouse: fixtures.warehouse1._id.toString(),
        reason: "Quarterly stock replenishment",
        generalRemarks: "Bulk replenishment for Q1",
        items: [
          {
            product: prodLaptop._id.toString(),
            quantity: 10,
            estimatedUnitPrice: 900,
            reason: "Low stock",
            remarks: "Urgent for sales team",
          },
          {
            product: prodKeyboard._id.toString(),
            quantity: 20,
            estimatedUnitPrice: 60,
            reason: "Low stock",
            remarks: "Buffer stock",
          },
          {
            product: prodMouse._id.toString(),
            quantity: 30,
            estimatedUnitPrice: 20,
            reason: "Routine replenishment",
            remarks: "Accessories depot",
          },
        ],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.items).toHaveLength(3);

    prId = res.body.data._id;
    const items = res.body.data.items;
    laptopPrItemId = items.find((i) => String(i.product._id || i.product) === String(prodLaptop._id))._id;
    keyboardPrItemId = items.find((i) => String(i.product._id || i.product) === String(prodKeyboard._id))._id;
    mousePrItemId = items.find((i) => String(i.product._id || i.product) === String(prodMouse._id))._id;

    // Verify creating PR does NOT increase physical stock
    const invLaptop = await Inventory.findOne({ product: prodLaptop._id, warehouse: fixtures.warehouse1._id });
    expect(invLaptop ? invLaptop.quantity : 0).toBe(0);
  });

  test("Step 2: Purchase Manager reviews & performs item-wise partial quantity approval", async () => {
    // Laptop: 10 approved (full)
    // Keyboard: 15 approved, 5 rejected (partial)
    // Mouse: 0 approved, 30 rejected (rejected)
    const res = await request(app)
      .patch(`/api/purchase-requests/${prId}/approve`)
      .set("Authorization", `Bearer ${purchaseToken}`)
      .send({
        remarks: "Approved essential items only; mouse request rejected due to supplier overstock.",
        items: [
          {
            itemId: laptopPrItemId,
            approvedQuantity: 10,
            rejectedQuantity: 0,
            remarks: "Fully approved",
          },
          {
            itemId: keyboardPrItemId,
            approvedQuantity: 15,
            rejectedQuantity: 5,
            remarks: "Budget cap allows 15 units",
          },
          {
            itemId: mousePrItemId,
            approvedQuantity: 0,
            rejectedQuantity: 30,
            remarks: "Current stock sufficient",
          },
        ],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("PARTIALLY_APPROVED");

    const updatedPr = await PurchaseRequest.findById(prId);
    const laptopItem = updatedPr.items.find((i) => String(i._id) === String(laptopPrItemId));
    expect(laptopItem.approvedQuantity).toBe(10);
    expect(laptopItem.remainingQuantity).toBe(10);
    expect(laptopItem.itemStatus).toBe("APPROVED");

    const keyboardItem = updatedPr.items.find((i) => String(i._id) === String(keyboardPrItemId));
    expect(keyboardItem.approvedQuantity).toBe(15);
    expect(keyboardItem.rejectedQuantity).toBe(5);
    expect(keyboardItem.remainingQuantity).toBe(15);
    expect(keyboardItem.itemStatus).toBe("PARTIALLY_APPROVED");

    const mouseItem = updatedPr.items.find((i) => String(i._id) === String(mousePrItemId));
    expect(mouseItem.approvedQuantity).toBe(0);
    expect(mouseItem.rejectedQuantity).toBe(30);
    expect(mouseItem.remainingQuantity).toBe(0);
    expect(mouseItem.itemStatus).toBe("REJECTED");
  });

  test("Step 3: Multi-Vendor Splitting - Create PO 1 for Vendor A with partial items", async () => {
    // Order 6 laptops and 10 keyboards from Vendor A
    const res = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${purchaseToken}`)
      .send({
        vendor: fixtures.vendor._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        purchaseRequest: prId,
        remarks: "First tranche: Vendor A",
        items: [
          {
            product: prodLaptop._id.toString(),
            purchaseRequestItemId: laptopPrItemId,
            quantity: 6,
            unitPrice: 880,
            tax: 20,
            discount: 10,
          },
          {
            product: prodKeyboard._id.toString(),
            purchaseRequestItemId: keyboardPrItemId,
            quantity: 10,
            unitPrice: 58,
            tax: 5,
            discount: 0,
          },
        ],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    po1Id = res.body.data._id;

    // Verify PR status transitioned to PARTIALLY_ORDERED
    const prAfterPo1 = await PurchaseRequest.findById(prId);
    expect(prAfterPo1.status).toBe("PARTIALLY_ORDERED");

    const laptopItem = prAfterPo1.items.find((i) => String(i._id) === String(laptopPrItemId));
    expect(laptopItem.orderedQuantity).toBe(6);
    expect(laptopItem.remainingQuantity).toBe(4);

    const keyboardItem = prAfterPo1.items.find((i) => String(i._id) === String(keyboardPrItemId));
    expect(keyboardItem.orderedQuantity).toBe(10);
    expect(keyboardItem.remainingQuantity).toBe(5);
  });

  test("Step 4: Prevent ordering exceeding approved remaining limits", async () => {
    // Laptop has 4 remaining. Attempting to order 5 should be blocked
    const res = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${purchaseToken}`)
      .send({
        vendor: vendorB._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        purchaseRequest: prId,
        items: [
          {
            product: prodLaptop._id.toString(),
            purchaseRequestItemId: laptopPrItemId,
            quantity: 5, // Exceeds remaining (4)
            unitPrice: 890,
          },
        ],
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Approved remaining quantity is 4");
  });

  test("Step 5: Multi-Vendor Splitting - Create PO 2 for Vendor B with remaining items", async () => {
    // Order remaining 4 laptops and 5 keyboards from Vendor B
    const res = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${purchaseToken}`)
      .send({
        vendor: vendorB._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        purchaseRequest: prId,
        remarks: "Second tranche: Vendor B",
        items: [
          {
            product: prodLaptop._id.toString(),
            purchaseRequestItemId: laptopPrItemId,
            quantity: 4,
            unitPrice: 890,
          },
          {
            product: prodKeyboard._id.toString(),
            purchaseRequestItemId: keyboardPrItemId,
            quantity: 5,
            unitPrice: 60,
          },
        ],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    po2Id = res.body.data._id;

    // Verify PR status transitioned to fully ORDERED
    const prAfterPo2 = await PurchaseRequest.findById(prId);
    expect(prAfterPo2.status).toBe("ORDERED");

    const laptopItem = prAfterPo2.items.find((i) => String(i._id) === String(laptopPrItemId));
    expect(laptopItem.orderedQuantity).toBe(10);
    expect(laptopItem.remainingQuantity).toBe(0);
    expect(laptopItem.itemStatus).toBe("ORDERED");

    const keyboardItem = prAfterPo2.items.find((i) => String(i._id) === String(keyboardPrItemId));
    expect(keyboardItem.orderedQuantity).toBe(15);
    expect(keyboardItem.remainingQuantity).toBe(0);
    expect(keyboardItem.itemStatus).toBe("ORDERED");
  });

  test("Step 6: Internal Approval of PO 1", async () => {
    const res = await request(app)
      .put(`/api/purchases/${po1Id}/approve`)
      .set("Authorization", `Bearer ${purchaseToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.internalApprovalStatus).toBe("APPROVED");
    expect(["APPROVED", "ORDERED"]).toContain(res.body.data.status);
  });

  test("Step 7: Dock Receiving (GRN) with Accepted, Damaged, and Rejected quantities", async () => {
    // For PO 1:
    // Laptop: ordered 6. Intake: 6 arrived, 1 damaged, 1 rejected -> 4 net accepted into sellable inventory!
    // Keyboard: ordered 10. Intake: 10 arrived, 0 damaged, 0 rejected -> 10 net accepted!
    const res = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        purchaseOrder: po1Id,
        warehouse: fixtures.warehouse1._id.toString(),
        remarks: "Dock delivery carrier FedEx #9021. Packaging partially damaged on 1 laptop.",
        items: [
          {
            product: prodLaptop._id.toString(),
            receivedQuantity: 6,
            damagedQuantity: 1,
            rejectedQuantity: 1,
          },
          {
            product: prodKeyboard._id.toString(),
            receivedQuantity: 10,
            damagedQuantity: 0,
            rejectedQuantity: 0,
          },
        ],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.grnNumber).toBeDefined();

    // Verify physical sellable inventory balances
    const invLaptop = await Inventory.findOne({ product: prodLaptop._id, warehouse: fixtures.warehouse1._id });
    expect(invLaptop).toBeDefined();
    expect(invLaptop.quantity).toBe(4); // Only accepted entered sellable stock!
    expect(invLaptop.damagedStock).toBe(1); // Damaged quarantined!

    const invKeyboard = await Inventory.findOne({ product: prodKeyboard._id, warehouse: fixtures.warehouse1._id });
    expect(invKeyboard).toBeDefined();
    expect(invKeyboard.quantity).toBe(10); // 10 clean units
    expect(invKeyboard.damagedStock).toBe(0);

    // Verify StockMovement logs
    const movements = await StockMovement.find({ warehouse: fixtures.warehouse1._id });
    const laptopStockIn = movements.find((m) => String(m.product) === String(prodLaptop._id) && m.type === "STOCK_IN");
    expect(laptopStockIn).toBeDefined();
    expect(laptopStockIn.quantity).toBe(4);

    const laptopDamaged = movements.find((m) => String(m.product) === String(prodLaptop._id) && m.type === "DAMAGED");
    expect(laptopDamaged).toBeDefined();
    expect(laptopDamaged.quantity).toBe(1);

    // Verify PO status updated to RECEIVED
    const po1Doc = await PurchaseOrder.findById(po1Id);
    expect(po1Doc.status).toBe("RECEIVED");
  });
});

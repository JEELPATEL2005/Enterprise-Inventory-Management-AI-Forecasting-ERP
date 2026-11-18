const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");
const SalesOrder = require("../../Models/SalesOrder");
const Return = require("../../Models/Return");
const Product = require("../../Models/Product");

let seedData, whToken, salesToken, adminToken, fixtures;
let prodPhone, prodCase;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  salesToken = helpers.getTokenForRole("SALES_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();

  prodPhone = await Product.create({
    productName: "Smartphone Pro",
    sku: `PHONE-${Date.now()}`,
    category: fixtures.category._id,
    brand: fixtures.brand._id,
    unitPrice: 800,
    costPrice: 500,
    unit: "PCS",
    status: "ACTIVE",
  });

  prodCase = await Product.create({
    productName: "Protective Silicone Case",
    sku: `CASE-${Date.now()}`,
    category: fixtures.category._id,
    brand: fixtures.brand._id,
    unitPrice: 30,
    costPrice: 10,
    unit: "PCS",
    status: "ACTIVE",
  });

  // Seed baseline stock for fulfilling initial sales order
  await Inventory.findOneAndUpdate(
    { product: prodPhone._id, warehouse: fixtures.warehouse1._id },
    { $set: { quantity: 50, reservedStock: 0, damagedStock: 0, repairStock: 0 } },
    { upsert: true }
  );

  await Inventory.findOneAndUpdate(
    { product: prodCase._id, warehouse: fixtures.warehouse1._id },
    { $set: { quantity: 100, reservedStock: 0, damagedStock: 0, repairStock: 0 } },
    { upsert: true }
  );
});

describe("Module 2: Multi-Item Sales Return & RMA Workflow", () => {
  let soId, rmaId, phoneRmaItemId, caseRmaItemId;

  beforeAll(async () => {
    // Create and fulfill a sales order: 5 phones and 10 cases
    const so = await SalesOrder.create({
      salesOrderNumber: `SO-${Date.now()}`,
      customer: fixtures.customer._id,
      warehouse: fixtures.warehouse1._id,
      status: "FULFILLED",
      subtotal: 4300,
      totalAmount: 4300,
      items: [
        {
          product: prodPhone._id,
          quantity: 5,
          unitPrice: 800,
          totalPrice: 4000,
        },
        {
          product: prodCase._id,
          quantity: 10,
          unitPrice: 30,
          totalPrice: 300,
        },
      ],
    });
    soId = so._id;

    // Deduct inventory for fulfilled order
    await Inventory.findOneAndUpdate(
      { product: prodPhone._id, warehouse: fixtures.warehouse1._id },
      { $inc: { quantity: -5 } }
    );
    await Inventory.findOneAndUpdate(
      { product: prodCase._id, warehouse: fixtures.warehouse1._id },
      { $inc: { quantity: -10 } }
    );
  });

  test("Step 1: Register Multi-Item Customer RMA with Over-Return Prevention", async () => {
    // Attempting to return 6 phones when only 5 were sold should fail
    const invalidRes = await request(app)
      .post("/api/returns")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({
        returnType: "SALES",
        salesOrder: soId.toString(),
        reason: "Customer dissatisfaction",
        items: [
          {
            product: prodPhone._id.toString(),
            quantity: 6, // Exceeds sold (5)
          },
        ],
      });

    expect(invalidRes.statusCode).toBe(400);
    expect(invalidRes.body.message).toContain("Maximum remaining returnable: 5");

    // Valid RMA: 3 phones and 4 cases
    const validRes = await request(app)
      .post("/api/returns")
      .set("Authorization", `Bearer ${salesToken}`)
      .send({
        returnType: "SALES",
        salesOrder: soId.toString(),
        reason: "Defective item & wrong color",
        refundAmount: 2520,
        items: [
          {
            product: prodPhone._id.toString(),
            quantity: 3,
            condition: "DAMAGED",
            reason: "Screen flickering",
          },
          {
            product: prodCase._id.toString(),
            quantity: 4,
            condition: "GOOD",
            reason: "Wrong color received",
          },
        ],
      });

    expect(validRes.statusCode).toBe(201);
    expect(validRes.body.success).toBe(true);
    expect(validRes.body.data.status).toBe("REQUESTED");
    expect(validRes.body.data.items).toHaveLength(2);

    rmaId = validRes.body.data._id;
    const items = validRes.body.data.items;
    phoneRmaItemId = items.find((i) => String(i.product._id || i.product) === String(prodPhone._id))._id;
    caseRmaItemId = items.find((i) => String(i.product._id || i.product) === String(prodCase._id))._id;

    // Verify stock is unchanged upon registration
    const invPhone = await Inventory.findOne({ product: prodPhone._id, warehouse: fixtures.warehouse1._id });
    expect(invPhone.quantity).toBe(45);
  });

  test("Step 2: Sales Manager Review & Partial Item-Wise RMA Approval", async () => {
    // Phone: 3 approved (full)
    // Case: 2 approved, 2 rejected (partial)
    const res = await request(app)
      .patch(`/api/returns/${rmaId}/approve`)
      .set("Authorization", `Bearer ${salesToken}`)
      .send({
        remarks: "RMA approved for return to Central Warehouse",
        items: [
          {
            itemId: phoneRmaItemId,
            approvedQuantity: 3,
            rejectedQuantity: 0,
            resolution: "REPLACEMENT",
          },
          {
            itemId: caseRmaItemId,
            approvedQuantity: 2,
            rejectedQuantity: 2,
            resolution: "REFUND",
            remarks: "2 cases exceeded 14-day policy",
          },
        ],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const rma = await Return.findById(rmaId);
    expect(rma.status).toBe("PARTIALLY_APPROVED");
    expect(rma.overallStatus).toBe("AWAITING_RETURN");

    const phoneItem = rma.items.find((i) => String(i._id) === String(phoneRmaItemId));
    expect(phoneItem.approvedQuantity).toBe(3);
    expect(phoneItem.itemStatus).toBe("APPROVED");

    const caseItem = rma.items.find((i) => String(i._id) === String(caseRmaItemId));
    expect(caseItem.approvedQuantity).toBe(2);
    expect(caseItem.rejectedQuantity).toBe(2);
    expect(caseItem.itemStatus).toBe("PARTIALLY_APPROVED");
  });

  test("Step 3: Physical Dock Receiving Check-in (Warehouse Manager)", async () => {
    // Arriving at dock: 3 phones and 2 cases
    const res = await request(app)
      .patch(`/api/returns/${rmaId}/receive`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        dockRemarks: "FedEx parcel received. Outer seal intact. Awaiting bench testing.",
        items: [
          {
            itemId: phoneRmaItemId,
            receivedQuantity: 3,
          },
          {
            itemId: caseRmaItemId,
            receivedQuantity: 2,
          },
        ],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const rma = await Return.findById(rmaId);
    expect(rma.status).toBe("RECEIVED");
    expect(rma.receiptHistory).toHaveLength(1);
    expect(rma.receiptHistory[0].dockRemarks).toContain("FedEx parcel received");

    // Critical invariant: Dock check-in does NOT increase sellable inventory!
    const invPhone = await Inventory.findOne({ product: prodPhone._id, warehouse: fixtures.warehouse1._id });
    expect(invPhone.quantity).toBe(45); // Unchanged!
    expect(invPhone.damagedStock || 0).toBe(0);
    expect(invPhone.repairStock || 0).toBe(0);
  });

  test("Step 4: 4-Tier Quality Inspection & Inventory Allocation", async () => {
    // 4-Tier allocation for Phone (3 received):
    // 1 Good (clean unit -> sellable stock)
    // 1 Damaged (cracked glass -> damagedStock)
    // 1 Repair Required (loose solder -> repairStock)
    // 4-Tier allocation for Case (2 received):
    // 2 Good (unopened -> sellable stock)
    const res = await request(app)
      .patch(`/api/returns/${rmaId}/inspect`)
      .set("Authorization", `Bearer ${whToken}`)
      .send({
        inspectionRemarks: "Hardware diagnostics performed in test bay",
        items: [
          {
            itemId: phoneRmaItemId,
            goodQuantity: 1,
            damagedQuantity: 1,
            repairQuantity: 1,
            rejectedQuantity: 0,
            remarks: "1 clean, 1 cracked screen, 1 battery contact loose",
          },
          {
            itemId: caseRmaItemId,
            goodQuantity: 2,
            damagedQuantity: 0,
            repairQuantity: 0,
            rejectedQuantity: 0,
            remarks: "Packaging unopened",
          },
        ],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const rma = await Return.findById(rmaId);
    expect(rma.status).toBe("INSPECTED");
    expect(rma.inspectionHistory).toHaveLength(1);

    // Verify phone stock allocation:
    // Started at 45 sellable, 0 damaged, 0 repair
    const invPhone = await Inventory.findOne({ product: prodPhone._id, warehouse: fixtures.warehouse1._id });
    expect(invPhone.quantity).toBe(46); // 45 + 1 Good
    expect(invPhone.damagedStock).toBe(1); // + 1 Damaged
    expect(invPhone.repairStock).toBe(1); // + 1 Repair

    // Verify case stock allocation:
    // Started at 90 sellable
    const invCase = await Inventory.findOne({ product: prodCase._id, warehouse: fixtures.warehouse1._id });
    expect(invCase.quantity).toBe(92); // 90 + 2 Good

    // Verify StockMovements
    const movements = await StockMovement.find({ referenceId: rmaId });
    expect(movements.some((m) => m.type === "SALES_RETURN_GOOD" && m.quantity === 1)).toBe(true);
    expect(movements.some((m) => m.type === "SALES_RETURN_DAMAGED" && m.quantity === 1)).toBe(true);
    expect(movements.some((m) => m.type === "SALES_RETURN_REPAIR" && m.quantity === 1)).toBe(true);
    expect(movements.some((m) => m.type === "SALES_RETURN_GOOD" && m.quantity === 2)).toBe(true);
  });

  test("Step 5a: Commercial Settlement via Credit Note (Refund)", async () => {
    const res = await request(app)
      .patch(`/api/returns/${rmaId}/resolve`)
      .set("Authorization", `Bearer ${salesToken}`)
      .send({
        resolutionType: "REFUND",
        refundAmount: 860,
        remarks: "Credit note issued for returned items",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const rma = await Return.findById(rmaId);
    expect(rma.status).toBe("COMPLETED");
    expect(rma.resolutionStatus).toBe("REFUNDED");
    expect(rma.creditNoteNumber).toMatch(/^CN-/);
    expect(rma.totalRefundAmount).toBe(860);
  });

  test("Step 5b: Commercial Settlement via Warranty Replacement Order", async () => {
    // Create a second RMA to test warranty replacement
    const rma2 = await Return.create({
      returnNumber: `RET-REP-${Date.now()}`,
      rmaNumber: `RET-REP-${Date.now()}`,
      returnType: "SALES",
      salesOrder: soId,
      customer: fixtures.customer._id,
      warehouse: fixtures.warehouse1._id,
      status: "INSPECTED",
      overallStatus: "INSPECTED",
      items: [
        {
          product: prodPhone._id,
          quantity: 1,
          requestedQuantity: 1,
          approvedQuantity: 1,
          receivedQuantity: 1,
          inspectedQuantity: 1,
          goodQuantity: 1,
          condition: "GOOD",
        },
      ],
      reason: "Warranty exchange",
    });

    const res = await request(app)
      .patch(`/api/returns/${rma2._id}/resolve`)
      .set("Authorization", `Bearer ${salesToken}`)
      .send({
        resolutionType: "REPLACEMENT",
        remarks: "Dispatched free replacement unit",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const updatedRma2 = await Return.findById(rma2._id).populate("replacementSalesOrder");
    expect(updatedRma2.status).toBe("COMPLETED");
    expect(updatedRma2.resolutionStatus).toBe("REPLACED");
    expect(updatedRma2.replacementSalesOrder).toBeDefined();
    expect(updatedRma2.replacementSalesOrder.salesOrderNumber).toMatch(/^SO-REP-/);
    expect(updatedRma2.replacementSalesOrder.totalAmount).toBe(0);
  });
});


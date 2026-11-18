const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Inventory = require("../../Models/Inventory");
const StockMovement = require("../../Models/StockMovement");
const Invoice = require("../../Models/Invoice");
const Return = require("../../Models/Return");
const PurchaseOrder = require("../../Models/PurchaseOrder");
const { createTestInventory } = helpers;

let seedData, smToken, adminToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  smToken = helpers.getTokenForRole("SALES_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();
});

describe("Invoice Payments Ledger & Partial Payments", () => {
  let testInvoiceId;

  beforeAll(async () => {
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 100, 0);

    const orderRes = await request(app)
      .post("/api/sales-orders")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customer: fixtures.customer._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 10, unitPrice: 50 }],
      });

    const orderId = orderRes.body.data._id;

    const invRes = await request(app)
      .post("/api/invoices")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        salesOrderId: orderId,
        taxAmount: 50,
        discountAmount: 0,
      });

    expect(invRes.statusCode).toBe(201);
    expect(invRes.body.data.totalAmount).toBe(550); // 500 + 50
    testInvoiceId = invRes.body.data._id;
  });

  test("PUT /api/invoices/:id/payment - should record partial payment and update balanceDue", async () => {
    const res = await request(app)
      .put(`/api/invoices/${testInvoiceId}/payment`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        amount: 200,
        paymentMethod: "BANK_TRANSFER",
        transactionRef: "TXN-PARTIAL-1",
        notes: "First installment",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amountPaid).toBe(200);
    expect(res.body.data.balanceDue).toBe(350); // 550 - 200
    expect(res.body.data.paymentStatus).toBe("PARTIALLY_PAID");
    expect(res.body.data.payments.length).toBe(1);
    expect(res.body.data.payments[0].transactionRef).toBe("TXN-PARTIAL-1");
  });

  test("PUT /api/invoices/:id/payment - should record final settlement and mark invoice PAID", async () => {
    const res = await request(app)
      .put(`/api/invoices/${testInvoiceId}/payment`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        amount: 350,
        paymentMethod: "UPI",
        transactionRef: "UPI-FINAL-2",
        notes: "Final clearance",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.amountPaid).toBe(550);
    expect(res.body.data.balanceDue).toBe(0);
    expect(res.body.data.paymentStatus).toBe("PAID");
    expect(res.body.data.status).toBe("PAID");
    expect(res.body.data.payments.length).toBe(2);
  });
});

describe("Purchase Returns (Vendor Supplier Returns)", () => {
  let createdPo;

  beforeAll(async () => {
    // Stock up warehouse with 100 units
    await createTestInventory(fixtures.product._id, fixtures.warehouse1._id, 100, 0);

    // Create an approved PO
    createdPo = await PurchaseOrder.create({
      purchaseOrderNumber: `PO-TEST-RET-${Date.now()}`,
      vendor: fixtures.vendor._id,
      warehouse: fixtures.warehouse1._id,
      items: [{ product: fixtures.product._id, quantity: 50, unitPrice: 20, totalPrice: 1000 }],
      totalAmount: 1000,
      internalApprovalStatus: "APPROVED",
      vendorAcceptanceStatus: "ACCEPTED",
      status: "APPROVED",
    });
  });

  test("POST /api/returns - should create a PURCHASE return for vendor", async () => {
    const res = await request(app)
      .post("/api/returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        returnType: "PURCHASE",
        purchaseOrder: createdPo._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        vendor: fixtures.vendor._id.toString(),
        debitNoteNumber: "DN-TEST-001",
        items: [
          {
            product: fixtures.product._id.toString(),
            quantity: 15,
            condition: "DAMAGED",
            reason: "Factory defect found during dock receipt",
          },
        ],
        reason: "Supplier batch defect RMA",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.returnType).toBe("PURCHASE");
    expect(res.body.data.returnNumber).toMatch(/^PRET-/);
    expect(res.body.data.debitNoteNumber).toBe("DN-TEST-001");
    expect(res.body.data.status).toBe("REQUESTED");
  });

  test("PUT /api/returns/:id/complete - should deduct stock from warehouse and log RETURN_OUT movement", async () => {
    const invBefore = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    const qtyBefore = invBefore.quantity;

    const createRes = await request(app)
      .post("/api/returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        returnType: "PURCHASE",
        purchaseOrder: createdPo._id.toString(),
        warehouse: fixtures.warehouse1._id.toString(),
        vendor: fixtures.vendor._id.toString(),
        debitNoteNumber: "DN-TEST-002",
        items: [
          {
            product: fixtures.product._id.toString(),
            quantity: 20,
            condition: "DAMAGED",
            reason: "Damaged packaging",
          },
        ],
        reason: "Returning 20 units to vendor",
      });

    const returnId = createRes.body.data._id;

    // Approve the return
    await request(app)
      .put(`/api/returns/${returnId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "APPROVED" });

    // Complete the return
    const completeRes = await request(app)
      .put(`/api/returns/${returnId}/complete`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.body.data.status).toBe("COMPLETED");

    // Inventory must be reduced by 20 units
    const invAfter = await Inventory.findOne({
      product: fixtures.product._id,
      warehouse: fixtures.warehouse1._id,
    });
    expect(invAfter.quantity).toBe(qtyBefore - 20);

    // StockMovement must be logged with type RETURN_OUT
    const movement = await StockMovement.findOne({
      referenceId: returnId,
      type: "RETURN_OUT",
    });
    expect(movement).not.toBeNull();
    expect(movement.quantity).toBe(20);
    expect(movement.previousQuantity).toBe(qtyBefore);
    expect(movement.newQuantity).toBe(qtyBefore - 20);
  });
});

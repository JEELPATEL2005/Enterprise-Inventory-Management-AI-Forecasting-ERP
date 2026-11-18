const request = require("supertest");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const PurchaseOrder = require("../../Models/PurchaseOrder");
const { generateResponseToken } = require("../../services/emailService");

describe("Vendor Email Response Workflow (Phase 7)", () => {
  let fixtures;
  let testPo;
  let rawToken;

  beforeAll(async () => {
    await helpers.seedTestDatabase();
    fixtures = await helpers.createTestFixtures();
  });

  beforeEach(async () => {
    const { token, hash } = generateResponseToken();
    rawToken = token;

    testPo = await PurchaseOrder.create({
      purchaseOrderNumber: `PO-TEST-VR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      vendor: fixtures.vendor._id,
      warehouse: fixtures.warehouse1._id,
      items: [
        {
          product: fixtures.product._id,
          quantity: 50,
          unitPrice: 120,
          receivedQuantity: 0,
        },
      ],
      totalAmount: 6000,
      status: "APPROVED",
      internalApprovalStatus: "APPROVED",
      vendorAcceptanceStatus: "PENDING",
      vendorResponseTokenHash: hash,
      vendorResponseExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 hours
      emailDeliveryStatus: "SENT",
    });
  });

  test("GET /api/purchase-orders/vendor-response/:token - should retrieve PO summary without authentication", async () => {
    const res = await request(app).get(`/api/purchase-orders/vendor-response/${rawToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.poNumber).toBe(testPo.purchaseOrderNumber);
    expect(res.body.data.totalAmount).toBe(6000);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.vendorAcceptanceStatus).toBe("PENDING");

    // CRITICAL: GET must NOT change the PO status
    const unchanged = await PurchaseOrder.findById(testPo._id);
    expect(unchanged.vendorAcceptanceStatus).toBe("PENDING");
  });

  test("GET /api/purchase-orders/vendor-response/:token - should reject invalid token", async () => {
    const res = await request(app).get("/api/purchase-orders/vendor-response/invalidtoken123456789012345");

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test("POST /api/purchase-orders/vendor-response/:token - should allow vendor to accept PO", async () => {
    const res = await request(app)
      .post(`/api/purchase-orders/vendor-response/${rawToken}`)
      .send({
        response: "ACCEPTED",
        remarks: "Shipment scheduled for next Tuesday.",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await PurchaseOrder.findById(testPo._id);
    expect(updated.vendorAcceptanceStatus).toBe("ACCEPTED");
    expect(updated.status).toBe("ORDERED");
    expect(updated.vendorRemarks).toBe("Shipment scheduled for next Tuesday.");
    expect(updated.vendorResponseTokenHash).toBeNull(); // Token invalidated after single use

    // Replay attack / reuse attempt must fail
    const replayRes = await request(app)
      .post(`/api/purchase-orders/vendor-response/${rawToken}`)
      .send({ response: "ACCEPTED" });

    expect(replayRes.statusCode).toBe(400);
  });

  test("POST /api/purchase-orders/vendor-response/:token - should allow vendor to reject PO with remarks", async () => {
    const res = await request(app)
      .post(`/api/purchase-orders/vendor-response/${rawToken}`)
      .send({
        response: "REJECTED",
        remarks: "Raw material supply shortage at manufacturing plant.",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const updated = await PurchaseOrder.findById(testPo._id);
    expect(updated.vendorAcceptanceStatus).toBe("REJECTED");
    expect(updated.vendorRemarks).toBe("Raw material supply shortage at manufacturing plant.");
    expect(updated.vendorResponseTokenHash).toBeNull();
  });
});

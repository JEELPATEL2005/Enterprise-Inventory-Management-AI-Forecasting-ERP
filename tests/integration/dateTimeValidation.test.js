const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const PurchaseRequest = require("../../Models/PurchaseRequest");
const PurchaseOrder = require("../../Models/PurchaseOrder");
const SalesOrder = require("../../Models/SalesOrder");
const Invoice = require("../../Models/Invoice");
const Product = require("../../Models/Product");
const Customer = require("../../Models/Customer");
const Vendor = require("../../Models/Vendor");

let seedData, whToken, purchaseToken, salesToken, adminToken, fixtures;
let testProd, testVendor, testCustomer;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  whToken = helpers.getTokenForRole("WAREHOUSE_MANAGER", seedData);
  purchaseToken = helpers.getTokenForRole("PURCHASE_MANAGER", seedData);
  salesToken = helpers.getTokenForRole("SALES_MANAGER", seedData);
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();

  testProd = await Product.create({
    productName: "Date Validation Test Item",
    sku: `DATE-TEST-${Date.now()}`,
    category: fixtures.category._id,
    brand: fixtures.brand._id,
    unitPrice: 150,
    costPrice: 90,
    unit: "PCS",
    status: "ACTIVE",
  });

  testVendor = await Vendor.create({
    vendorName: "Date Validation Supplier Ltd",
    contactPerson: "Jane Smith",
    email: `datesupplier_${Date.now()}@testvendor.com`,
    phone: "1234567890",
    status: "ACTIVE",
  });

  testCustomer = await Customer.create({
    customerName: "Date Validation Client Corp",
    email: `dateclient_${Date.now()}@testclient.com`,
    phone: "9876543210",
    status: "ACTIVE",
  });
});

afterAll(async () => {
  await helpers.cleanTestDatabase();
  await mongoose.connection.close();
});

describe("Comprehensive Date and Time Validation Across All Modules", () => {
  describe("1. Purchase Request Date Validation", () => {
    it("should REJECT purchase request when requiredDeliveryDate is in the past (400)", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/purchase-requests")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          warehouse: fixtures.warehouse1._id,
          requiredDeliveryDate: yesterday,
          reason: "Past date test",
          items: [{ product: testProd._id, requestedQuantity: 5 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot be in the past/i);
    });

    it("should REJECT purchase request when requiredDeliveryDate is malformed (400)", async () => {
      const res = await request(app)
        .post("/api/purchase-requests")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          warehouse: fixtures.warehouse1._id,
          requiredDeliveryDate: "invalid-date-string",
          reason: "Malformed date test",
          items: [{ product: testProd._id, requestedQuantity: 5 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*date/i);
    });

    it("should ACCEPT purchase request when requiredDeliveryDate is today or future (201)", async () => {
      const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/purchase-requests")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          warehouse: fixtures.warehouse1._id,
          requiredDeliveryDate: futureDate,
          reason: "Future date valid test",
          items: [{ product: testProd._id, requestedQuantity: 5 }],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(new Date(res.body.data.requiredDeliveryDate).toISOString().split("T")[0]).toBe(futureDate);
    });
  });

  describe("2. Purchase Order Date Validation", () => {
    it("should REJECT purchase order when expectedDate is in the past (400)", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${purchaseToken}`)
        .send({
          vendor: testVendor._id,
          warehouse: fixtures.warehouse1._id,
          expectedDate: yesterday,
          items: [{ product: testProd._id, quantity: 10, unitPrice: 90 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot be in the past/i);
    });

    it("should REJECT purchase order when expectedDate is malformed (400)", async () => {
      const res = await request(app)
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${purchaseToken}`)
        .send({
          vendor: testVendor._id,
          warehouse: fixtures.warehouse1._id,
          expectedDate: "not-a-date",
          items: [{ product: testProd._id, quantity: 10, unitPrice: 90 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*date/i);
    });

    it("should ACCEPT purchase order when expectedDate is today or future (201)", async () => {
      const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/purchase-orders")
        .set("Authorization", `Bearer ${purchaseToken}`)
        .send({
          vendor: testVendor._id,
          warehouse: fixtures.warehouse1._id,
          expectedDate: futureDate,
          items: [{ product: testProd._id, quantity: 10, unitPrice: 90 }],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe("3. Goods Receipt Date Validation", () => {
    let validPo;
    beforeAll(async () => {
      validPo = await PurchaseOrder.create({
        purchaseOrderNumber: `PO-GRN-VAL-${Date.now()}`,
        vendor: testVendor._id,
        warehouse: fixtures.warehouse1._id,
        status: "APPROVED",
        internalApprovalStatus: "APPROVED",
        vendorAcceptanceStatus: "ACCEPTED",
        items: [{ product: testProd._id, quantity: 20, unitPrice: 90, receivedQuantity: 0 }],
        totalAmount: 1800,
      });
    });

    it("should REJECT goods receipt when receiptDate is in the future (400)", async () => {
      const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .post("/api/goods-receipts")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          purchaseOrder: validPo._id,
          warehouse: fixtures.warehouse1._id,
          receiptDate: tomorrow,
          items: [{ product: testProd._id, receivedQuantity: 5, damagedQuantity: 0, rejectedQuantity: 0 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot be in the future/i);
    });

    it("should ACCEPT goods receipt when receiptDate is today or past (201)", async () => {
      const today = new Date().toISOString();

      const res = await request(app)
        .post("/api/goods-receipts")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          purchaseOrder: validPo._id,
          warehouse: fixtures.warehouse1._id,
          receiptDate: today,
          items: [{ product: testProd._id, receivedQuantity: 5, damagedQuantity: 0, rejectedQuantity: 0 }],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe("4. Sales Order Date Validation", () => {
    it("should REJECT sales order when deliveryDate is in the past (400)", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/sales-orders")
        .set("Authorization", `Bearer ${salesToken}`)
        .send({
          customer: testCustomer._id,
          warehouse: fixtures.warehouse1._id,
          deliveryDate: yesterday,
          items: [{ product: testProd._id, quantity: 2, unitPrice: 150 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot be in the past/i);
    });

    it("should ACCEPT sales order when deliveryDate is today or future (201)", async () => {
      const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/sales-orders")
        .set("Authorization", `Bearer ${salesToken}`)
        .send({
          customer: testCustomer._id,
          warehouse: fixtures.warehouse1._id,
          deliveryDate: futureDate,
          items: [{ product: testProd._id, quantity: 2, unitPrice: 150 }],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe("5. Invoice and Payment Date Validation", () => {
    let salesOrderDoc, invoiceDoc;

    beforeAll(async () => {
      salesOrderDoc = await SalesOrder.create({
        salesOrderNumber: `SO-INV-VAL-${Date.now()}`,
        customer: testCustomer._id,
        warehouse: fixtures.warehouse1._id,
        items: [{ product: testProd._id, quantity: 1, unitPrice: 150, totalPrice: 150 }],
        subtotal: 150,
        totalAmount: 150,
        status: "DELIVERED",
      });

      invoiceDoc = await Invoice.create({
        salesOrder: salesOrderDoc._id,
        customer: testCustomer._id,
        invoiceNumber: `INV-VAL-${Date.now()}`,
        items: [{ product: testProd._id, quantity: 1, unitPrice: 150, totalPrice: 150 }],
        subtotal: 150,
        totalAmount: 150,
        amountPaid: 0,
        balanceDue: 150,
        status: "ISSUED",
        paymentStatus: "UNPAID",
      });
    });

    it("should REJECT payment recording when paymentDate is in the future (400)", async () => {
      const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .put(`/api/invoices/${invoiceDoc._id}/payment`)
        .set("Authorization", `Bearer ${salesToken}`)
        .send({
          amount: 50,
          paymentMethod: "BANK_TRANSFER",
          paymentDate: tomorrow,
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot be in the future/i);
    });

    it("should ACCEPT payment recording when paymentDate is today or past (200)", async () => {
      const today = new Date().toISOString();

      const res = await request(app)
        .put(`/api/invoices/${invoiceDoc._id}/payment`)
        .set("Authorization", `Bearer ${salesToken}`)
        .send({
          amount: 50,
          paymentMethod: "BANK_TRANSFER",
          paymentDate: today,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amountPaid).toBe(50);
    });
  });

  describe("6. Stock Transfer Date Validation", () => {
    it("should REJECT stock transfer when transferDate is in the future (400)", async () => {
      const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .post("/api/stock-transfers")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          sourceWarehouse: fixtures.warehouse1._id,
          destinationWarehouse: fixtures.warehouse2._id,
          transferDate: tomorrow,
          items: [{ product: testProd._id, quantity: 5 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot be in the future/i);
    });

    it("should REJECT stock transfer when expectedArrivalDate is in the past (400)", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/stock-transfers")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          sourceWarehouse: fixtures.warehouse1._id,
          destinationWarehouse: fixtures.warehouse2._id,
          expectedArrivalDate: yesterday,
          items: [{ product: testProd._id, quantity: 5 }],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot be in the past/i);
    });

    it("should ACCEPT stock transfer with valid current/future dates (201)", async () => {
      const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const res = await request(app)
        .post("/api/stock-transfers")
        .set("Authorization", `Bearer ${whToken}`)
        .send({
          sourceWarehouse: fixtures.warehouse1._id,
          destinationWarehouse: fixtures.warehouse2._id,
          expectedArrivalDate: futureDate,
          items: [{ product: testProd._id, quantity: 5 }],
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe("7. Audit Log Date Range Validation", () => {
    it("should REJECT audit log query when startDate is after endDate (400)", async () => {
      const res = await request(app)
        .get("/api/audit-logs?startDate=2026-11-10&endDate=2026-11-01")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/startDate cannot be after endDate/i);
    });

    it("should REJECT audit log query with malformed date strings (400)", async () => {
      const res = await request(app)
        .get("/api/audit-logs?startDate=invalid-date")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*format/i);
    });

    it("should ACCEPT valid date range query (200)", async () => {
      const res = await request(app)
        .get("/api/audit-logs?startDate=2026-01-01&endDate=2026-12-31")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

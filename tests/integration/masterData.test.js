/**
 * Integration Tests: Product, Vendor, Customer, Warehouse APIs
 * Tests CRUD operations, validations, and business rules.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const { getTokenForRole } = helpers;

let seedData, adminToken, fixtures;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  adminToken = getTokenForRole("SUPER_ADMIN", seedData);
  fixtures = await helpers.createTestFixtures();
});

// ========== PRODUCT TESTS ==========
describe("Product API", () => {
  let createdProductId;

  test("POST /api/products - should create product", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productName: "Integration Test Product",
        sku: `ITP-${Date.now()}`,
        category: fixtures.category._id.toString(),
        brand: fixtures.brand._id.toString(),
        unitPrice: 199.99,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.productName).toBe("Integration Test Product");
    createdProductId = res.body.data._id;
  });

  test("GET /api/products - should list products", async () => {
    const res = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/products/:id - should get single product", async () => {
    const res = await request(app)
      .get(`/api/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data._id).toBe(createdProductId);
  });

  test("PUT /api/products/:id - should update product", async () => {
    const res = await request(app)
      .put(`/api/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ unitPrice: 249.99 });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.unitPrice).toBe(249.99);
  });

  test("POST /api/products - should reject missing required fields", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productName: "No SKU" });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/products - should reject invalid category", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productName: "Bad Cat",
        sku: `BADCAT-${Date.now()}`,
        unitPrice: 10,
        category: "invalid-id",
      });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/products - should reject non-existent category", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productName: "Ghost Cat",
        sku: `GCAT-${Date.now()}`,
        unitPrice: 10,
        category: new mongoose.Types.ObjectId().toString(),
      });

    expect(res.statusCode).toBe(404);
  });

  test("POST /api/products - should reject duplicate SKU", async () => {
    const sku = `DUP-${Date.now()}`;
    await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productName: "First",
        sku,
        unitPrice: 10,
        category: fixtures.category._id.toString(),
      });

    const res = await request(app)
      .post("/api/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        productName: "Second",
        sku,
        unitPrice: 20,
        category: fixtures.category._id.toString(),
      });

    expect(res.statusCode).toBe(409);
  });

  test("DELETE /api/products/:id - should delete product", async () => {
    const res = await request(app)
      .delete(`/api/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("GET /api/products/:id - should 404 for deleted product", async () => {
    const res = await request(app)
      .get(`/api/products/${createdProductId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(404);
  });

  test("GET /api/products/invalid-id - should 400 for invalid ID", async () => {
    const res = await request(app)
      .get("/api/products/invalid-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(400);
  });
});

// ========== VENDOR TESTS ==========
describe("Vendor API", () => {
  let createdVendorId;
  let pmToken;

  beforeAll(async () => {
    pmToken = getTokenForRole("PURCHASE_MANAGER", seedData);
  });

  test("POST /api/vendors - should create vendor", async () => {
    const res = await request(app)
      .post("/api/vendors")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendorName: "Test Vendor API",
        phone: "9876543210",
        email: "vendor-api@test.com",
        address: "Test Street",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    createdVendorId = res.body.data._id;
  });

  test("GET /api/vendors - should list vendors", async () => {
    const res = await request(app)
      .get("/api/vendors")
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/vendors/:id - should get vendor", async () => {
    const res = await request(app)
      .get(`/api/vendors/${createdVendorId}`)
      .set("Authorization", `Bearer ${pmToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("PUT /api/vendors/:id - should update vendor", async () => {
    const res = await request(app)
      .put(`/api/vendors/${createdVendorId}`)
      .set("Authorization", `Bearer ${pmToken}`)
      .send({ rating: 5 });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.rating).toBe(5);
  });

  test("POST /api/vendors - should reject missing name", async () => {
    const res = await request(app)
      .post("/api/vendors")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({ phone: "1234567890" });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/vendors - should reject missing phone", async () => {
    const res = await request(app)
      .post("/api/vendors")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({ vendorName: "No Phone" });

    expect(res.statusCode).toBe(400);
  });

  test("POST /api/vendors - should reject invalid phone format", async () => {
    const res = await request(app)
      .post("/api/vendors")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({ vendorName: "Bad Phone", phone: "abc" });

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/vendors/:id - should deactivate vendor", async () => {
    const res = await request(app)
      .put(`/api/vendors/${createdVendorId}`)
      .set("Authorization", `Bearer ${pmToken}`)
      .send({ status: "INACTIVE" });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("INACTIVE");
  });

  test("Purchase Order should reject inactive vendor", async () => {
    const res = await request(app)
      .post("/api/purchases")
      .set("Authorization", `Bearer ${pmToken}`)
      .send({
        vendor: createdVendorId,
        warehouse: fixtures.warehouse1._id.toString(),
        items: [
          {
            product: fixtures.product._id.toString(),
            quantity: 10,
            unitPrice: 100,
          },
        ],
      });

    // Inactive vendor should be rejected (400 or 404 or 422 depending on implementation)
    expect([400, 404, 422]).toContain(res.statusCode);
  });
});

// ========== CUSTOMER TESTS ==========
describe("Customer API", () => {
  let createdCustomerId;
  let smToken;

  beforeAll(async () => {
    smToken = getTokenForRole("SALES_MANAGER", seedData);
  });

  test("POST /api/customers - should create customer", async () => {
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${smToken}`)
      .send({
        customerName: "Test Customer API",
        phone: "9876543212",
        email: "cust-api@test.com",
        address: "Customer Street",
      });

    expect(res.statusCode).toBe(201);
    createdCustomerId = res.body.data._id;
  });

  test("GET /api/customers - should list customers", async () => {
    const res = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/customers/:id - should get customer", async () => {
    const res = await request(app)
      .get(`/api/customers/${createdCustomerId}`)
      .set("Authorization", `Bearer ${smToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("PUT /api/customers/:id - should update customer", async () => {
    const res = await request(app)
      .put(`/api/customers/${createdCustomerId}`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({ address: "New Address" });

    expect(res.statusCode).toBe(200);
  });

  test("POST /api/customers - should reject missing required fields", async () => {
    const res = await request(app)
      .post("/api/customers")
      .set("Authorization", `Bearer ${smToken}`)
      .send({});

    expect(res.statusCode).toBe(400);
  });

  test("PUT /api/customers/:id - should deactivate customer", async () => {
    const res = await request(app)
      .put(`/api/customers/${createdCustomerId}`)
      .set("Authorization", `Bearer ${smToken}`)
      .send({ status: "INACTIVE" });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("INACTIVE");
  });
});

// ========== WAREHOUSE TESTS ==========
describe("Warehouse API", () => {
  let createdWhId;

  test("POST /api/warehouses - should create warehouse", async () => {
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        warehouseName: `WH-API-${Date.now()}`,
        location: "Mumbai, Maharashtra",
        capacity: 2000,
      });

    expect(res.statusCode).toBe(201);
    createdWhId = res.body.data._id;
  });

  test("GET /api/warehouses - should list warehouses", async () => {
    const res = await request(app)
      .get("/api/warehouses")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test("GET /api/warehouses/:id - should get warehouse", async () => {
    const res = await request(app)
      .get(`/api/warehouses/${createdWhId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
  });

  test("PUT /api/warehouses/:id - should deactivate warehouse", async () => {
    const res = await request(app)
      .put(`/api/warehouses/${createdWhId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "INACTIVE" });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("INACTIVE");
  });
});

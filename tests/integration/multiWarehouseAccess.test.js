/**
 * Integration Test Suite: Multi-Warehouse Management & Warehouse-Specific Access Control
 *
 * Covers:
 * 1. User/Employee model assignedWarehouses extension & User model alias
 * 2. Warehouse Manager assignment & reassignment by Super Admin
 * 3. Warehouse performance metrics & capacity utilization analytics
 * 4. Warehouse Manager scoped permissions (view, stock-in, stock-out, adjust, damaged quarantine)
 * 5. PR creation scoped to assigned warehouse
 * 6. PO receiving & GRN generation scoped to delivery warehouse
 * 7. Sales Order fulfillment/dispatch scoped to fulfillment warehouse
 * 8. Inter-warehouse transfer workflow (Request -> Approve -> Dispatch -> Complete) with cross-warehouse authorization
 * 9. Central Warehouse Operations Manager read-only monitoring access
 * 10. Multi-warehouse dashboards & warehouse-wise reports
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Employee = require("../../Models/Employee");
const User = require("../../Models/User");
const Warehouse = require("../../Models/Warehouse");
const Inventory = require("../../Models/Inventory");
const Product = require("../../Models/Product");
const StockTransfer = require("../../Models/StockTransfer");
const StockMovement = require("../../Models/StockMovement");
const PurchaseRequest = require("../../Models/PurchaseRequest");
const PurchaseOrder = require("../../Models/PurchaseOrder");
const SalesOrder = require("../../Models/SalesOrder");
const Role = require("../../Models/Role");
const { generateAccessToken } = require("../../services/authService");
const { ROLES } = require("../../Middleware/roleMiddleware");

let seedData, adminToken, pmToken, fixtures;
let whManagerA, whTokenA, whA;
let whManagerB, whTokenB, whB;
let centralOpsManager, centralOpsToken;

beforeAll(async () => {
  seedData = await helpers.seedTestDatabase();
  adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
  pmToken = helpers.getTokenForRole("PURCHASE_MANAGER", seedData);
  fixtures = await helpers.createTestFixtures();

  const whRole = seedData.roleMap[ROLES.WAREHOUSE_MANAGER];

  // Create Warehouse A
  whA = await Warehouse.create({
    warehouseName: `North-Facility-${Date.now()}`,
    location: "North Logistics Park, Chicago, IL",
    capacity: 2000,
    status: "ACTIVE",
  });

  // Create Warehouse B
  whB = await Warehouse.create({
    warehouseName: `South-Facility-${Date.now()}`,
    location: "South Distribution Center, Dallas, TX",
    capacity: 3000,
    status: "ACTIVE",
  });

  // Create Manager A (Assigned only to Warehouse A)
  whManagerA = await Employee.create({
    name: "Alice Warehouse Lead",
    email: `alice.wh.${Date.now()}@erp.local`,
    password: await helpers.hashPassword ? await helpers.hashPassword(helpers.TEST_PASSWORD) : "hashed_pw",
    department: "WAREHOUSE",
    role: whRole._id,
    assignedWarehouses: [whA._id],
    status: "ACTIVE",
  });
  whA.primaryManager = whManagerA._id;
  await whA.save();

  whTokenA = generateAccessToken(whManagerA, { _id: whRole._id, roleName: ROLES.WAREHOUSE_MANAGER }, helpers.ROLE_PERMISSIONS[ROLES.WAREHOUSE_MANAGER]);

  // Create Manager B (Assigned only to Warehouse B)
  whManagerB = await Employee.create({
    name: "Bob Warehouse Lead",
    email: `bob.wh.${Date.now()}@erp.local`,
    password: await helpers.hashPassword ? await helpers.hashPassword(helpers.TEST_PASSWORD) : "hashed_pw",
    department: "WAREHOUSE",
    role: whRole._id,
    assignedWarehouses: [whB._id],
    status: "ACTIVE",
  });
  whB.primaryManager = whManagerB._id;
  await whB.save();

  whTokenB = generateAccessToken(whManagerB, { _id: whRole._id, roleName: ROLES.WAREHOUSE_MANAGER }, helpers.ROLE_PERMISSIONS[ROLES.WAREHOUSE_MANAGER]);

  // Create Central Warehouse Operations Manager
  centralOpsManager = await Employee.create({
    name: "Carol Central Ops",
    email: `carol.ops.${Date.now()}@erp.local`,
    password: await helpers.hashPassword ? await helpers.hashPassword(helpers.TEST_PASSWORD) : "hashed_pw",
    department: "WAREHOUSE",
    role: whRole._id,
    assignedWarehouses: [],
    status: "ACTIVE",
  });

  centralOpsToken = generateAccessToken(
    centralOpsManager,
    { _id: whRole._id, roleName: ROLES.CENTRAL_WAREHOUSE_OPERATIONS_MANAGER },
    helpers.ROLE_PERMISSIONS[ROLES.WAREHOUSE_MANAGER]
  );
});

describe("1. User Model & Warehouse Manager Assignment Architecture", () => {
  test("User model alias resolves to Employee model with assignedWarehouses schema", () => {
    expect(User).toBe(Employee);
    expect(User.schema.path("assignedWarehouses")).toBeDefined();
  });

  test("Warehouse model has primaryManager and manager virtual alias", async () => {
    const found = await Warehouse.findById(whA._id).populate("primaryManager");
    expect(found.primaryManager._id.toString()).toBe(whManagerA._id.toString());
    expect(found.manager._id.toString()).toBe(whManagerA._id.toString());
  });

  test("POST /api/warehouses - Admin creates new warehouse with primary manager", async () => {
    const res = await request(app)
      .post("/api/warehouses")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        warehouseName: `East-Hub-${Date.now()}`,
        location: "East Pier, Boston, MA",
        capacity: 4500,
        primaryManager: whManagerA._id.toString(),
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.capacity).toBe(4500);

    // Verify manager's assignedWarehouses updated
    const updatedMgr = await Employee.findById(whManagerA._id);
    expect(updatedMgr.assignedWarehouses.map((id) => id.toString())).toContain(res.body.data._id);
  });

  test("PUT /api/warehouses/:id/assign-manager - Admin reassigns manager", async () => {
    // Reassign whA from Manager A to Manager B
    const res = await request(app)
      .put(`/api/warehouses/${whA._id}/assign-manager`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ managerId: whManagerB._id.toString() });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Manager A should no longer have whA
    const mgrA = await Employee.findById(whManagerA._id);
    expect(mgrA.assignedWarehouses.map((id) => id.toString())).not.toContain(whA._id.toString());

    // Manager B should now have whA
    const mgrB = await Employee.findById(whManagerB._id);
    expect(mgrB.assignedWarehouses.map((id) => id.toString())).toContain(whA._id.toString());

    // Restore whA to Manager A for subsequent tests
    await request(app)
      .put(`/api/warehouses/${whA._id}/assign-manager`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ managerId: whManagerA._id.toString() });
  });

  test("GET /api/warehouses/:id/performance - View warehouse performance analytics", async () => {
    // Populate some inventory in whA
    await helpers.createTestInventory(fixtures.product._id, whA._id, 100, 10);

    const res = await request(app)
      .get(`/api/warehouses/${whA._id}/performance`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.warehouse.id).toBe(whA._id.toString());
    expect(res.body.metrics.totalQuantity).toBe(100);
    expect(res.body.metrics.reservedStock).toBe(10);
    expect(res.body.metrics.availableStock).toBe(90);
    expect(res.body.metrics.capacityUtilization).toBeGreaterThan(0);
  });

  test("DELETE /api/warehouses/:id - Blocks deletion if warehouse has active inventory", async () => {
    const res = await request(app)
      .delete(`/api/warehouses/${whA._id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/holds inventory/i);
  });
});

describe("2. Warehouse-Specific Scoped Access Control (Manager Isolation)", () => {
  beforeEach(async () => {
    await helpers.createTestInventory(fixtures.product._id, whA._id, 100, 0);
    await helpers.createTestInventory(fixtures.product._id, whB._id, 50, 0);
  });

  test("Manager A can view inventory for assigned Warehouse A", async () => {
    const res = await request(app)
      .get(`/api/inventory/warehouse/${whA._id}`)
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.warehouse.id).toBe(whA._id.toString());
  });

  test("Manager A receives 403 Forbidden when attempting to view unassigned Warehouse B", async () => {
    const res = await request(app)
      .get(`/api/inventory/warehouse/${whB._id}`)
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Forbidden/i);
  });

  test("Manager A can stock-in to assigned Warehouse A", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: whA._id.toString(),
        quantity: 25,
        remarks: "Authorized shipment intake",
      });

    expect([200, 201]).toContain(res.statusCode);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quantity).toBe(125);
  });

  test("Manager A receives 403 Forbidden when attempting stock-in to unassigned Warehouse B", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: whB._id.toString(),
        quantity: 50,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not assigned/i);
  });

  test("Manager A receives 403 Forbidden when attempting stock-out from unassigned Warehouse B", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-out")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: whB._id.toString(),
        quantity: 10,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not assigned/i);
  });

  test("Manager A receives 403 Forbidden when attempting stock adjust on unassigned Warehouse B", async () => {
    const invB = await Inventory.findOne({ product: fixtures.product._id, warehouse: whB._id });

    const res = await request(app)
      .put(`/api/inventory/${invB._id}/adjust`)
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        quantity: 80,
        reason: "Unauthorized count adjustment",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test("Manager A receives 403 Forbidden when attempting to quarantine damaged stock in unassigned Warehouse B", async () => {
    const res = await request(app)
      .post("/api/inventory/damaged")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: whB._id.toString(),
        quantity: 5,
        reason: "Forklift drop",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe("3. Warehouse-Scoped Purchase Requests & PO Receiving", () => {
  test("Manager A can create Purchase Request for assigned Warehouse A", async () => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        warehouse: whA._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 30 }],
        reason: "Restock needed for warehouse A",
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.warehouse._id.toString()).toBe(whA._id.toString());
  });

  test("Manager A receives 403 Forbidden when creating Purchase Request for unassigned Warehouse B", async () => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        warehouse: whB._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 50 }],
        reason: "Unauthorized PR for facility B",
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test("Manager A receives 403 Forbidden when attempting to receive goods for PO destined to Warehouse B", async () => {
    // Create PO destined to Warehouse B
    const poB = await PurchaseOrder.create({
      purchaseOrderNumber: `PO-WHB-${Date.now()}`,
      vendor: fixtures.vendor._id,
      warehouse: whB._id,
      items: [{ product: fixtures.product._id, quantity: 40, unitPrice: 80, receivedQuantity: 0 }],
      totalAmount: 3200,
      status: "APPROVED",
      internalApprovalStatus: "APPROVED",
      vendorAcceptanceStatus: "ACCEPTED",
    });

    const res = await request(app)
      .post("/api/goods-receipts")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        purchaseOrder: poB._id.toString(),
        warehouse: whB._id.toString(),
        items: [{ product: fixtures.product._id.toString(), receivedQuantity: 40 }],
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not assigned/i);
  });
});

describe("4. Warehouse-Scoped Sales Order Fulfillment / Dispatch", () => {
  test("Manager A receives 403 Forbidden when fulfilling a Sales Order allocated to Warehouse B", async () => {
    // Setup reserved sales order in Warehouse B
    await helpers.createTestInventory(fixtures.product._id, whB._id, 100, 20);

    const soB = await SalesOrder.create({
      salesOrderNumber: `SO-WHB-${Date.now()}`,
      customer: fixtures.customer._id,
      warehouse: whB._id,
      items: [{ product: fixtures.product._id, quantity: 20, unitPrice: 150, totalPrice: 3000 }],
      totalAmount: 3000,
      status: "RESERVED",
    });

    const res = await request(app)
      .put(`/api/sales-orders/${soB._id}/fulfill`)
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not assigned/i);
  });
});

describe("5. Inter-Warehouse Stock Transfer Full Lifecycle", () => {
  let transferId;

  beforeEach(async () => {
    await helpers.createTestInventory(fixtures.product._id, whA._id, 100, 0);
    await helpers.createTestInventory(fixtures.product._id, whB._id, 20, 0);
  });

  test("Manager A can request stock transfer from Warehouse A to Warehouse B", async () => {
    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${whTokenA}`)
      .send({
        sourceWarehouse: whA._id.toString(),
        destinationWarehouse: whB._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 25 }],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("REQUESTED");
    transferId = res.body.data._id;
  });

  test("Unauthorized employee cannot initiate transfer between unassigned warehouses", async () => {
    const otherEmployee = await Employee.create({
      name: "Dave Logistics",
      email: `dave.logistics.${Date.now()}@erp.local`,
      password: "hashed_password",
      department: "WAREHOUSE",
      role: seedData.roleMap[ROLES.WAREHOUSE_MANAGER]._id,
      assignedWarehouses: [], // No warehouses assigned
      status: "ACTIVE",
    });

    const daveToken = generateAccessToken(otherEmployee, { _id: seedData.roleMap[ROLES.WAREHOUSE_MANAGER]._id, roleName: ROLES.WAREHOUSE_MANAGER }, []);

    const res = await request(app)
      .post("/api/stock-transfers")
      .set("Authorization", `Bearer ${daveToken}`)
      .send({
        sourceWarehouse: whA._id.toString(),
        destinationWarehouse: whB._id.toString(),
        items: [{ product: fixtures.product._id.toString(), quantity: 10 }],
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test("Manager A (source warehouse manager) approves transfer", async () => {
    const res = await request(app)
      .put(`/api/stock-transfers/${transferId}/approve`)
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("APPROVED");
  });

  test("Manager A dispatches transfer (marks IN_TRANSIT)", async () => {
    const res = await request(app)
      .put(`/api/stock-transfers/${transferId}/dispatch`)
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("IN_TRANSIT");
  });

  test("Manager A cannot complete transfer at destination Warehouse B (403 Forbidden)", async () => {
    const res = await request(app)
      .put(`/api/stock-transfers/${transferId}/complete`)
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/destination warehouse/i);
  });

  test("Manager B (destination warehouse manager) completes transfer and verifies atomic inventory update", async () => {
    const res = await request(app)
      .put(`/api/stock-transfers/${transferId}/complete`)
      .set("Authorization", `Bearer ${whTokenB}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("COMPLETED");

    // Source Warehouse A was 100, transferred 25 -> should now be 75
    const invA = await Inventory.findOne({ product: fixtures.product._id, warehouse: whA._id });
    expect(invA.quantity).toBe(75);

    // Destination Warehouse B was 20, received 25 -> should now be 45
    const invB = await Inventory.findOne({ product: fixtures.product._id, warehouse: whB._id });
    expect(invB.quantity).toBe(45);

    // Verify stock movements created
    const moveOut = await StockMovement.findOne({
      type: "TRANSFER_OUT",
      referenceId: transferId,
      warehouse: whA._id,
    });
    expect(moveOut).toBeTruthy();
    expect(moveOut.quantity).toBe(25);

    const moveIn = await StockMovement.findOne({
      type: "TRANSFER_IN",
      referenceId: transferId,
      warehouse: whB._id,
    });
    expect(moveIn).toBeTruthy();
    expect(moveIn.quantity).toBe(25);
  });
});

describe("6. Central Warehouse Operations Manager Permissions", () => {
  test("Central Operations Manager can view inventory across all warehouses", async () => {
    const res = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${centralOpsToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("Central Operations Manager cannot directly modify physical inventory (receives 403 Forbidden)", async () => {
    const res = await request(app)
      .post("/api/inventory/stock-in")
      .set("Authorization", `Bearer ${centralOpsToken}`)
      .send({
        product: fixtures.product._id.toString(),
        warehouse: whA._id.toString(),
        quantity: 10,
      });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Forbidden/i);
  });
});

describe("7. Warehouse Dashboards & Warehouse-Specific Reports", () => {
  test("GET /api/dashboard/warehouse/:id returns individual warehouse dashboard", async () => {
    const res = await request(app)
      .get(`/api/dashboard/warehouse/${whA._id}`)
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.warehouse.id).toBe(whA._id.toString());
    expect(res.body.metrics).toHaveProperty("capacityUtilization");
    expect(res.body.metrics).toHaveProperty("totalStock");
    expect(res.body.operations).toHaveProperty("pendingIncomingPOs");
  });

  test("GET /api/reports/warehouse_stock returns warehouse-wise stock report", async () => {
    const res = await request(app)
      .get("/api/reports/warehouse_stock")
      .set("Authorization", `Bearer ${whTokenA}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reportType).toBe("WAREHOUSE_STOCK");
  });

  test("GET /api/reports/consolidated_inventory returns consolidated multi-facility summary", async () => {
    const res = await request(app)
      .get("/api/reports/consolidated_inventory")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reportType).toBe("CONSOLIDATED_INVENTORY");
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

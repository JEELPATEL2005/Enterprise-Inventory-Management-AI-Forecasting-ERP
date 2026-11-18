/**
 * Integration Test: Method 1 - Warehouse Manager Provisioning & Assignment
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const helpers = require("../helpers/testHelpers");
const Employee = require("../../Models/Employee");
const Warehouse = require("../../Models/Warehouse");
const { ROLES } = require("../../Middleware/roleMiddleware");

describe("Method 1: Warehouse Manager Creation & Assignment Workflow", () => {
  let seedData, adminToken, whRole, testWarehouse1, testWarehouse2;

  beforeAll(async () => {
    seedData = await helpers.seedTestDatabase();
    adminToken = helpers.getTokenForRole("SUPER_ADMIN", seedData);
    whRole = seedData.roleMap[ROLES.WAREHOUSE_MANAGER];

    testWarehouse1 = await Warehouse.create({
      warehouseName: `Central-Hub-${Date.now()}`,
      location: "Building A, Tech Park",
      capacity: 5000,
      status: "ACTIVE",
    });

    testWarehouse2 = await Warehouse.create({
      warehouseName: `South-Hub-${Date.now()}`,
      location: "Building B, Logistics Zone",
      capacity: 8000,
      status: "ACTIVE",
    });
  });

  afterAll(async () => {
    if (testWarehouse1) await Warehouse.findByIdAndDelete(testWarehouse1._id);
    if (testWarehouse2) await Warehouse.findByIdAndDelete(testWarehouse2._id);
  });

  test("1. Admin provisions new Warehouse Manager with assignedWarehouses in one step", async () => {
    const res = await request(app)
      .post("/api/employees")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Marcus Vance",
        email: `marcus.warehouse.${Date.now()}@erp.local`,
        password: "Password123!",
        department: "WAREHOUSE",
        role: whRole._id,
        phone: "+1 (555) 789-0123",
        assignedWarehouses: [testWarehouse1._id],
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Marcus Vance");
    expect(res.body.data.assignedWarehouses).toHaveLength(1);
    expect(String(res.body.data.assignedWarehouses[0]._id)).toBe(String(testWarehouse1._id));

    // Verify bidirectional sync: Warehouse has Marcus as primaryManager
    const updatedWh = await Warehouse.findById(testWarehouse1._id);
    expect(String(updatedWh.primaryManager)).toBe(String(res.body.data._id));
  });

  test("2. Admin updates Warehouse Manager facility assignments (adding testWarehouse2)", async () => {
    // Create another manager
    const empRes = await request(app)
      .post("/api/employees")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Elena Rostova",
        email: `elena.warehouse.${Date.now()}@erp.local`,
        password: "Password123!",
        department: "WAREHOUSE",
        role: whRole._id,
        phone: "+1 (555) 321-6547",
      });

    expect(empRes.statusCode).toBe(201);
    const elenaId = empRes.body.data._id;

    // Update Elena to manage testWarehouse2
    const updateRes = await request(app)
      .put(`/api/employees/${elenaId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        assignedWarehouses: [testWarehouse2._id],
      });

    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.body.data.assignedWarehouses).toHaveLength(1);
    expect(String(updateRes.body.data.assignedWarehouses[0]._id)).toBe(String(testWarehouse2._id));

    // Verify testWarehouse2 has Elena as primaryManager
    const updatedWh2 = await Warehouse.findById(testWarehouse2._id);
    expect(String(updatedWh2.primaryManager)).toBe(String(elenaId));
  });

  test("3. Workforce directory list endpoint populates assignedWarehouses", async () => {
    const res = await request(app)
      .get("/api/employees")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const warehouseManagers = res.body.data.filter(
      (e) => e.department === "WAREHOUSE" && e.assignedWarehouses && e.assignedWarehouses.length > 0
    );
    expect(warehouseManagers.length).toBeGreaterThan(0);
    expect(warehouseManagers[0].assignedWarehouses[0]).toHaveProperty("warehouseName");
  });

  test("4. Warehouse assign-manager endpoint maintains bidirectional assignment", async () => {
    // Create fresh manager
    const empRes = await request(app)
      .post("/api/employees")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "David Kim",
        email: `david.warehouse.${Date.now()}@erp.local`,
        password: "Password123!",
        department: "WAREHOUSE",
        role: whRole._id,
      });

    const davidId = empRes.body.data._id;

    // Assign via warehouse controller
    const assignRes = await request(app)
      .put(`/api/warehouses/${testWarehouse1._id}/assign-manager`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ managerId: davidId });

    expect(assignRes.statusCode).toBe(200);
    expect(String(assignRes.body.data.primaryManager._id)).toBe(String(davidId));

    // Verify David has testWarehouse1 in assignedWarehouses
    const updatedDavid = await Employee.findById(davidId);
    expect(updatedDavid.assignedWarehouses.map(String)).toContain(String(testWarehouse1._id));
  });
});


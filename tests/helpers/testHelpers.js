/**
 * Test helper utilities for seeding roles, permissions, employees,
 * and generating JWT tokens for integration tests.
 */
const mongoose = require("mongoose");
const Role = require("../../Models/Role");
const Permission = require("../../Models/Permission");
const Employee = require("../../Models/Employee");
const Category = require("../../Models/Category");
const Brand = require("../../Models/Brand");
const Product = require("../../Models/Product");
const Warehouse = require("../../Models/Warehouse");
const Vendor = require("../../Models/Vendor");
const Customer = require("../../Models/Customer");
const Inventory = require("../../Models/Inventory");
const { hashPassword, generateAccessToken } = require("../../services/authService");
const { ROLES } = require("../../Middleware/roleMiddleware");

// Canonical permissions for each role (subset for testing)
const PERMISSION_DATA = [
  { permissionName: "employee.manage", module: "ADMIN" },
  { permissionName: "role.manage", module: "ADMIN" },
  { permissionName: "audit.view", module: "ADMIN" },
  { permissionName: "master.manage", module: "MASTER" },
  { permissionName: "product.view", module: "MASTER" },
  { permissionName: "product.manage", module: "MASTER" },
  { permissionName: "category.view", module: "MASTER" },
  { permissionName: "category.manage", module: "MASTER" },
  { permissionName: "brand.view", module: "MASTER" },
  { permissionName: "brand.manage", module: "MASTER" },
  { permissionName: "warehouse.view", module: "MASTER" },
  { permissionName: "warehouse.manage", module: "MASTER" },
  { permissionName: "vendor.view", module: "MASTER" },
  { permissionName: "vendor.manage", module: "MASTER" },
  { permissionName: "customer.view", module: "MASTER" },
  { permissionName: "customer.manage", module: "MASTER" },
  { permissionName: "purchase_request.create", module: "PURCHASE" },
  { permissionName: "purchase_request.view", module: "PURCHASE" },
  { permissionName: "purchase_request.approve", module: "PURCHASE" },
  { permissionName: "purchase_order.create", module: "PURCHASE" },
  { permissionName: "purchase_order.view", module: "PURCHASE" },
  { permissionName: "purchase_order.manage", module: "PURCHASE" },
  { permissionName: "goods_receipt.record", module: "PURCHASE" },
  { permissionName: "goods_receipt.view", module: "PURCHASE" },
  { permissionName: "goods.receive", module: "PURCHASE" },
  { permissionName: "inventory.view", module: "WAREHOUSE" },
  { permissionName: "inventory.manage", module: "WAREHOUSE" },
  { permissionName: "stock.in", module: "WAREHOUSE" },
  { permissionName: "stock.out", module: "WAREHOUSE" },
  { permissionName: "stock.adjust", module: "WAREHOUSE" },
  { permissionName: "stock.transfer.create", module: "WAREHOUSE" },
  { permissionName: "stock.transfer.approve", module: "WAREHOUSE" },
  { permissionName: "stock.transfer.view", module: "WAREHOUSE" },
  { permissionName: "stock.damaged.handle", module: "WAREHOUSE" },
  { permissionName: "sales_order.create", module: "SALES" },
  { permissionName: "sales_order.view", module: "SALES" },
  { permissionName: "sales_order.manage", module: "SALES" },
  { permissionName: "sales_order.fulfill", module: "SALES" },
  { permissionName: "stock.check", module: "SALES" },
  { permissionName: "stock.reserve", module: "SALES" },
  { permissionName: "invoice.generate", module: "SALES" },
  { permissionName: "invoice.view", module: "SALES" },
  { permissionName: "invoice.manage", module: "SALES" },
  { permissionName: "delivery.manage", module: "SALES" },
  { permissionName: "delivery.assign", module: "SALES" },
  { permissionName: "delivery.view", module: "SALES" },
  { permissionName: "delivery.status", module: "SALES" },
  { permissionName: "returns.process", module: "SALES" },
  { permissionName: "returns.view", module: "SALES" },
];

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: PERMISSION_DATA.map((p) => p.permissionName),
  PURCHASE_MANAGER: [
    "vendor.view", "vendor.manage",
    "purchase_request.create", "purchase_request.view", "purchase_request.approve",
    "purchase_order.create", "purchase_order.view", "purchase_order.manage",
    "goods_receipt.record", "goods_receipt.view", "goods.receive",
    "inventory.view", "product.view", "warehouse.view", "category.view", "brand.view",
  ],
  WAREHOUSE_MANAGER: [
    "warehouse.view", "inventory.view", "inventory.manage",
    "product.view", "category.view", "brand.view",
    "stock.in", "stock.out", "stock.adjust",
    "stock.transfer.create", "stock.transfer.approve", "stock.transfer.view",
    "goods.receive", "goods_receipt.record", "goods_receipt.view",
    "stock.damaged.handle", "purchase_order.view", "sales_order.view",
  ],
  SALES_MANAGER: [
    "customer.view", "customer.manage",
    "sales_order.create", "sales_order.view", "sales_order.manage", "sales_order.fulfill",
    "stock.check", "stock.reserve", "inventory.view",
    "product.view", "category.view", "brand.view",
    "invoice.generate", "invoice.view", "invoice.manage",
    "delivery.manage", "delivery.assign", "delivery.view", "delivery.status",
    "returns.process", "returns.view",
  ],
};

let seeded = false;
const seedCache = {};

/**
 * Seed canonical RBAC data (permissions, roles, employees) into the test database.
 * Idempotent – only runs once per test suite.
 */
const seedTestDatabase = async () => {
  if (seeded) return seedCache;

  // 1. Seed Permissions
  const permMap = {};
  for (const p of PERMISSION_DATA) {
    const doc = await Permission.findOneAndUpdate(
      { permissionName: p.permissionName },
      { $set: p },
      { upsert: true, new: true }
    );
    permMap[p.permissionName] = doc._id;
  }

  // 2. Seed Roles
  const roleMap = {};
  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
    const permIds = permNames.map((n) => permMap[n]).filter(Boolean);
    const roleDoc = await Role.findOneAndUpdate(
      { roleName },
      { $set: { roleName, permissions: permIds, status: "ACTIVE", description: `${roleName} test role` } },
      { upsert: true, new: true }
    );
    roleMap[roleName] = roleDoc;
  }

  // 3. Seed one employee per role
  const hashedPw = await hashPassword("TestPass123!");
  const employeeMap = {};

  const accounts = [
    { name: "Test Super Admin", email: "superadmin@test.erp", department: "ADMIN", roleName: ROLES.SUPER_ADMIN },
    { name: "Test Purchase Manager", email: "purchase@test.erp", department: "PURCHASE", roleName: ROLES.PURCHASE_MANAGER },
    { name: "Test Warehouse Manager", email: "warehouse@test.erp", department: "WAREHOUSE", roleName: ROLES.WAREHOUSE_MANAGER },
    { name: "Test Sales Manager", email: "sales@test.erp", department: "SALES", roleName: ROLES.SALES_MANAGER },
  ];

  for (const acc of accounts) {
    let emp = await Employee.findOne({ email: acc.email });
    if (!emp) {
      emp = await Employee.create({
        name: acc.name,
        email: acc.email,
        password: hashedPw,
        phone: "1234567890",
        department: acc.department,
        role: roleMap[acc.roleName]._id,
        status: "ACTIVE",
      });
    }
    employeeMap[acc.roleName] = emp;
  }

  Object.assign(seedCache, { permMap, roleMap, employeeMap });
  seeded = true;
  return seedCache;
};

/**
 * Generate a valid JWT access token for the given role.
 */
const getTokenForRole = (roleName, seedData) => {
  const { roleMap, employeeMap } = seedData;
  const emp = employeeMap[roleName];
  const role = roleMap[roleName];
  const permissions = ROLE_PERMISSIONS[roleName] || [];
  return generateAccessToken(emp, { _id: role._id, roleName: role.roleName }, permissions);
};

/**
 * Clean all collections except Roles, Permissions, and test Employees.
 * Useful between test suites to maintain test isolation.
 */
const cleanCollections = async (exceptModels = []) => {
  const defaultExcept = ["Role", "Permission", "Employee"];
  const skipSet = new Set([...defaultExcept, ...exceptModels]);
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    const modelName = key.charAt(0).toUpperCase() + key.slice(1);
    // crude singular check
    if (!skipSet.has(modelName) && !skipSet.has(modelName.replace(/s$/, ""))) {
      await collections[key].deleteMany({});
    }
  }
};

/**
 * Create common test fixtures (category, brand, product, warehouses, vendor, customer).
 */
const createTestFixtures = async () => {
  const category = await Category.create({ categoryName: `TestCat-${Date.now()}`, description: "Test category", status: "ACTIVE" });
  const brand = await Brand.create({ brandName: `TestBrand-${Date.now()}`, description: "Test brand", status: "ACTIVE" });
  const product = await Product.create({
    productName: "Test Widget",
    sku: `SKU-${Date.now()}`,
    category: category._id,
    brand: brand._id,
    unitPrice: 100,
    unit: "PCS",
    status: "ACTIVE",
    safetyStock: 10,
    leadTimeDays: 7,
    averageDailyDemand: 5,
  });

  const product2 = await Product.create({
    productName: "Test Gadget",
    sku: `SKU2-${Date.now()}`,
    category: category._id,
    brand: brand._id,
    unitPrice: 250,
    unit: "PCS",
    status: "ACTIVE",
  });

  const warehouse1 = await Warehouse.create({
    warehouseName: `Ahmedabad-WH-${Date.now()}`,
    location: "Ahmedabad, Gujarat",
    capacity: 5000,
    status: "ACTIVE",
  });

  const warehouse2 = await Warehouse.create({
    warehouseName: `Surat-WH-${Date.now()}`,
    location: "Surat, Gujarat",
    capacity: 3000,
    status: "ACTIVE",
  });

  // Assign fixtures warehouses to default test warehouse manager for suite backward-compatibility
  if (seedCache.employeeMap && seedCache.employeeMap[ROLES.WAREHOUSE_MANAGER]) {
    await Employee.findByIdAndUpdate(seedCache.employeeMap[ROLES.WAREHOUSE_MANAGER]._id, {
      $addToSet: { assignedWarehouses: { $each: [warehouse1._id, warehouse2._id] } },
    });
  }

  const vendor = await Vendor.create({
    vendorName: "Test Vendor Corp",
    phone: "9876543210",
    email: "vendor@test.com",
    address: "123 Vendor Street",
    rating: 4,
    status: "ACTIVE",
  });

  const customer = await Customer.create({
    customerName: "Test Customer Inc",
    phone: "9876543211",
    email: "customer@test.com",
    address: "456 Customer Avenue",
    status: "ACTIVE",
  });

  return { category, brand, product, product2, warehouse1, warehouse2, vendor, customer };
};

/**
 * Create an inventory record for testing.
 */
const createTestInventory = async (productId, warehouseId, quantity = 100, reservedStock = 0) => {
  return Inventory.findOneAndUpdate(
    { product: productId, warehouse: warehouseId },
    {
      $set: {
        quantity,
        reservedStock,
        reorderPoint: 10,
        reorderLevel: 10,
        safetyStock: 5,
        damagedStock: 0,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );
};

module.exports = {
  seedTestDatabase,
  getTokenForRole,
  cleanCollections,
  createTestFixtures,
  createTestInventory,
  ROLE_PERMISSIONS,
  TEST_PASSWORD: "TestPass123!",
};

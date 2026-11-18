/**
 * Integration Tests: Authentication APIs
 * Tests login, register, refresh token, logout, JWT validation.
 */
const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../../server");
const { getTokenForRole, seedTestDatabase, TEST_PASSWORD } = require("../helpers/testHelpers");
const RefreshToken = require("../../Models/RefreshToken");
const Employee = require("../../Models/Employee");
const { hashPassword } = require("../../services/authService");

describe("POST /api/auth/login", () => {
  test("should login with valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "superadmin@test.erp", password: TEST_PASSWORD });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe("SUPER_ADMIN");
    // Must not expose password
    expect(res.body.user.password).toBeUndefined();
  });

  test("should fail with invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nonexistent@test.erp", password: TEST_PASSWORD });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("should fail with invalid password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "superadmin@test.erp", password: "WrongPassword123!" });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test("should fail with missing email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ password: TEST_PASSWORD });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("should fail with missing password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "superadmin@test.erp" });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test("should fail for inactive employee", async () => {
    const seedData = await seedTestDatabase();
    const inactiveEmp = await Employee.findOneAndUpdate(
      { email: "inactive-login-test@test.erp" },
      {
        name: "Inactive User",
        email: "inactive-login-test@test.erp",
        password: await hashPassword(TEST_PASSWORD),
        phone: "1234567890",
        department: "ADMIN",
        role: seedData.roleMap.SUPER_ADMIN._id,
        status: "INACTIVE",
      },
      { upsert: true, returnDocument: "after" }
    );

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "inactive-login-test@test.erp", password: TEST_PASSWORD });

    expect(res.statusCode).toBe(403);

    // Cleanup
    await Employee.findByIdAndDelete(inactiveEmp._id);
  });

  test("should return correct permissions for each role", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "purchase@test.erp", password: TEST_PASSWORD });

    expect(res.statusCode).toBe(200);
    expect(res.body.user.role).toBe("PURCHASE_MANAGER");
    expect(res.body.user.permissions).toBeInstanceOf(Array);
    expect(res.body.user.permissions.length).toBeGreaterThan(0);
  });
});

describe("JWT Token Validation", () => {
  test("should access protected route with valid token", async () => {
    const seedData = await seedTestDatabase();
    const token = getTokenForRole("SUPER_ADMIN", seedData);

    const res = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("should return 401 with missing token", async () => {
    const res = await request(app).get("/api/products");
    expect(res.statusCode).toBe(401);
  });

  test("should return 401 with invalid token", async () => {
    const res = await request(app)
      .get("/api/products")
      .set("Authorization", "Bearer invalid-garbage-token");

    expect(res.statusCode).toBe(401);
  });

  test("should return 401 with malformed Authorization header", async () => {
    const res = await request(app)
      .get("/api/products")
      .set("Authorization", "NotBearer sometoken");

    expect(res.statusCode).toBe(401);
  });

  test("should return 401 with expired token", async () => {
    const jwt = require("jsonwebtoken");
    const expiredToken = jwt.sign(
      { id: new mongoose.Types.ObjectId(), roleName: "SUPER_ADMIN" },
      process.env.JWT_SECRET,
      { expiresIn: "0s" }
    );

    await new Promise((r) => setTimeout(r, 100));
    const res = await request(app)
      .get("/api/products")
      .set("Authorization", `Bearer ${expiredToken}`);

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/auth/refresh-token", () => {
  let validRefreshToken;

  beforeAll(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "superadmin@test.erp", password: TEST_PASSWORD });
    validRefreshToken = loginRes.body.refreshToken;
  });

  test("should refresh with valid refresh token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh-token")
      .send({ refreshToken: validRefreshToken });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(validRefreshToken);
  });

  test("should fail with missing refresh token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh-token")
      .send({});

    expect(res.statusCode).toBe(400);
  });

  test("should fail with invalid refresh token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh-token")
      .send({ refreshToken: "invalid-token-value" });

    expect(res.statusCode).toBe(401);
  });

  test("should fail with revoked refresh token", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "warehouse@test.erp", password: TEST_PASSWORD });
    const token = loginRes.body.refreshToken;

    await RefreshToken.findOneAndUpdate({ token }, { revoked: true });

    const res = await request(app)
      .post("/api/auth/refresh-token")
      .send({ refreshToken: token });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/auth/register", () => {
  test("should register a new Purchase Manager", async () => {
    const seedData = await seedTestDatabase();
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "New PM",
        email: `newpm-${Date.now()}@test.erp`,
        password: "SecurePass123!",
        role: seedData.roleMap.PURCHASE_MANAGER._id.toString(),
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test("should not allow Super Admin registration", async () => {
    const seedData = await seedTestDatabase();
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Hacker Admin",
        email: `hacker-${Date.now()}@test.erp`,
        password: "SecurePass123!",
        role: seedData.roleMap.SUPER_ADMIN._id.toString(),
      });

    expect(res.statusCode).toBe(403);
  });

  test("should reject duplicate email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({
        name: "Duplicate",
        email: "superadmin@test.erp",
        password: "SecurePass123!",
        role: "PURCHASE_MANAGER",
      });

    expect(res.statusCode).toBe(409);
  });

  test("should reject missing required fields", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "NoEmail" });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  test("should logout successfully", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "superadmin@test.erp", password: TEST_PASSWORD });

    const res = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

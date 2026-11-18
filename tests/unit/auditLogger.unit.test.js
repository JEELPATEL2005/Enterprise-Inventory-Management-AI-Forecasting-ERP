/**
 * Unit Tests: Audit Logger Utility
 * Verifies that sensitive data is sanitized and audit entries are created correctly.
 */
const mongoose = require("mongoose");
const AuditLog = require("../../Models/AuditLog");
const { logAudit } = require("../../Utils/auditLogger");

describe("Audit Logger", () => {
  const employeeId = new mongoose.Types.ObjectId();

  afterEach(async () => {
    await AuditLog.deleteMany({});
  });

  test("creates an audit log entry with correct fields", async () => {
    const log = await logAudit({
      employeeId,
      action: "PRODUCT_CREATED",
      entityType: "PRODUCT",
      entityId: new mongoose.Types.ObjectId(),
      description: "Test product created",
      newData: { name: "Widget" },
      ipAddress: "127.0.0.1",
    });

    expect(log).not.toBeNull();
    expect(log.action).toBe("PRODUCT_CREATED");
    expect(log.entityType).toBe("PRODUCT");
    expect(log.employee.toString()).toBe(employeeId.toString());
  });

  test("returns null when required fields are missing", async () => {
    const log = await logAudit({ action: "TEST" });
    expect(log).toBeNull();
  });

  test("sanitizes sensitive data from oldData/newData", async () => {
    const log = await logAudit({
      employeeId,
      action: "USER_UPDATED",
      entityType: "EMPLOYEE",
      newData: {
        name: "John",
        password: "secret123",
        refreshToken: "token-value",
        jwt: "jwt-value",
        email: "john@test.com",
      },
    });

    expect(log).not.toBeNull();
    const data = log.newData;
    expect(data.name).toBe("John");
    expect(data.email).toBe("john@test.com");
    // Sensitive fields must be omitted
    expect(data.password).toBeUndefined();
    expect(data.refreshToken).toBeUndefined();
    expect(data.jwt).toBeUndefined();
  });

  test("sanitizes nested sensitive data", async () => {
    const log = await logAudit({
      employeeId,
      action: "TEST",
      entityType: "TEST",
      newData: {
        user: {
          name: "Jane",
          password: "pass123",
          apiKey: "key-123",
        },
      },
    });

    expect(log.newData.user.name).toBe("Jane");
    expect(log.newData.user.password).toBeUndefined();
    expect(log.newData.user.apiKey).toBeUndefined();
  });

  test("uppercases action value", async () => {
    const log = await logAudit({
      employeeId,
      action: "create_product",
      entityType: "PRODUCT",
    });
    expect(log.action).toBe("CREATE_PRODUCT");
  });
});

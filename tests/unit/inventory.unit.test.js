/**
 * Unit Tests: Inventory Business Logic & Model Validations
 * Tests:
 * 1. calculateAvailableStock()
 * 2. validateStockAvailability()
 * 3. validateQuantity()
 * 4. Inventory model virtuals and schema validation
 */
const mongoose = require("mongoose");
const Inventory = require("../../Models/Inventory");
const {
  calculateAvailableStock,
  validateQuantity,
  validateStockAvailability,
} = require("../../Utils/businessLogic");

describe("calculateAvailableStock() utility", () => {
  test("calculates available stock correctly for normal quantities", () => {
    // availableStock = quantity - reservedStock
    expect(calculateAvailableStock(100, 30)).toBe(70);
    expect(calculateAvailableStock(50, 0)).toBe(50);
    expect(calculateAvailableStock(25, 25)).toBe(0);
  });

  test("handles zero quantity correctly", () => {
    expect(calculateAvailableStock(0, 0)).toBe(0);
    expect(calculateAvailableStock(0, 10)).toBe(0);
  });

  test("returns 0 when reserved stock is greater than quantity", () => {
    expect(calculateAvailableStock(20, 50)).toBe(0);
  });

  test("returns 0 for negative quantity or negative reserved stock", () => {
    expect(calculateAvailableStock(-10, 5)).toBe(0);
    expect(calculateAvailableStock(50, -5)).toBe(0);
    expect(calculateAvailableStock(-20, -10)).toBe(0);
  });

  test("handles invalid inputs gracefully (NaN, strings, null, undefined)", () => {
    expect(calculateAvailableStock(null, 10)).toBe(0);
    expect(calculateAvailableStock(undefined, 10)).toBe(0);
    expect(calculateAvailableStock("abc", 10)).toBe(0);
    expect(calculateAvailableStock(100, "xyz")).toBe(0);
    expect(calculateAvailableStock(NaN, NaN)).toBe(0);
  });

  test("handles default reservedStock of 0 when omitted", () => {
    expect(calculateAvailableStock(100)).toBe(100);
  });
});

describe("validateQuantity() utility", () => {
  test("validates normal positive integers", () => {
    expect(validateQuantity(1)).toEqual({ valid: true, error: null });
    expect(validateQuantity(100)).toEqual({ valid: true, error: null });
    expect(validateQuantity(9999)).toEqual({ valid: true, error: null });
  });

  test("rejects zero quantity", () => {
    const res = validateQuantity(0);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/greater than zero/i);
  });

  test("rejects negative quantities", () => {
    const res = validateQuantity(-5);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/greater than zero/i);
  });

  test("rejects non-integer / floating-point quantities", () => {
    const res = validateQuantity(5.5);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/integer/i);
  });

  test("rejects null, undefined, and non-numeric inputs", () => {
    expect(validateQuantity(null).valid).toBe(false);
    expect(validateQuantity(undefined).valid).toBe(false);
    expect(validateQuantity("abc").valid).toBe(false);
    expect(validateQuantity(Infinity).valid).toBe(false);
  });
});

describe("validateStockAvailability() utility", () => {
  test("allows request when available stock is sufficient", () => {
    const res = validateStockAvailability(100, 50);
    expect(res.available).toBe(true);
    expect(res.error).toBeNull();
  });

  test("allows request when requested quantity exactly equals available stock", () => {
    const res = validateStockAvailability(50, 50);
    expect(res.available).toBe(true);
    expect(res.error).toBeNull();
  });

  test("rejects request when requested quantity exceeds available stock", () => {
    const res = validateStockAvailability(40, 50);
    expect(res.available).toBe(false);
    expect(res.error).toMatch(/insufficient stock/i);
  });

  test("rejects request when available stock is zero", () => {
    const res = validateStockAvailability(0, 10);
    expect(res.available).toBe(false);
    expect(res.error).toMatch(/insufficient stock/i);
  });

  test("rejects invalid requested quantities", () => {
    expect(validateStockAvailability(100, 0).available).toBe(false);
    expect(validateStockAvailability(100, -5).available).toBe(false);
    expect(validateStockAvailability(100, "invalid").available).toBe(false);
  });
});

describe("Inventory Model - availableStock virtual", () => {
  test("availableStock = quantity - reservedStock (normal)", () => {
    const inv = new Inventory({ quantity: 100, reservedStock: 30 });
    expect(inv.availableStock).toBe(70);
  });

  test("availableStock when quantity is zero", () => {
    const inv = new Inventory({ quantity: 0, reservedStock: 0 });
    expect(inv.availableStock).toBe(0);
  });

  test("availableStock with no reserved stock", () => {
    const inv = new Inventory({ quantity: 50, reservedStock: 0 });
    expect(inv.availableStock).toBe(50);
  });

  test("availableStock when reserved equals quantity", () => {
    const inv = new Inventory({ quantity: 100, reservedStock: 100 });
    expect(inv.availableStock).toBe(0);
  });

  test("availableStock returns 0 when reservedStock > quantity (Math.max guard)", () => {
    const inv = new Inventory({ quantity: 10, reservedStock: 50 });
    expect(inv.availableStock).toBe(0);
  });

  test("availableStock handles undefined reservedStock gracefully", () => {
    const inv = new Inventory({ quantity: 100 });
    expect(inv.availableStock).toBe(100);
  });

  test("availableStock handles undefined quantity gracefully", () => {
    const inv = new Inventory({});
    expect(inv.availableStock).toBe(0);
  });

  test("availableStock handles non-numeric values gracefully", () => {
    const inv = new Inventory({ quantity: "abc", reservedStock: "xyz" });
    expect(inv.availableStock).toBe(0);
  });
});

describe("Inventory Model - Validation", () => {
  test("quantity cannot be negative", async () => {
    const inv = new Inventory({
      product: new mongoose.Types.ObjectId(),
      warehouse: new mongoose.Types.ObjectId(),
      quantity: -10,
    });
    await expect(inv.validate()).rejects.toThrow(/negative/i);
  });

  test("reservedStock cannot be negative", async () => {
    const inv = new Inventory({
      product: new mongoose.Types.ObjectId(),
      warehouse: new mongoose.Types.ObjectId(),
      reservedStock: -5,
    });
    await expect(inv.validate()).rejects.toThrow(/negative/i);
  });

  test("reorderPoint cannot be negative", async () => {
    const inv = new Inventory({
      product: new mongoose.Types.ObjectId(),
      warehouse: new mongoose.Types.ObjectId(),
      reorderPoint: -1,
    });
    await expect(inv.validate()).rejects.toThrow(/negative/i);
  });

  test("valid inventory record passes validation", async () => {
    const inv = new Inventory({
      product: new mongoose.Types.ObjectId(),
      warehouse: new mongoose.Types.ObjectId(),
      quantity: 100,
      reservedStock: 10,
      reorderPoint: 20,
      safetyStock: 5,
    });
    await expect(inv.validate()).resolves.toBeUndefined();
  });
});

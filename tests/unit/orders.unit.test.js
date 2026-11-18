/**
 * Unit Tests: Order Calculations Business Logic
 * Tests:
 * 1. calculateSubtotal()
 * 2. calculateTax()
 * 3. calculateDiscount()
 * 4. calculateOrderTotal()
 */
const {
  calculateSubtotal,
  calculateTax,
  calculateDiscount,
  calculateOrderTotal,
} = require("../../Utils/businessLogic");

describe("calculateSubtotal()", () => {
  test("calculates subtotal for normal items", () => {
    const items = [
      { quantity: 2, unitPrice: 50 },
      { quantity: 3, unitPrice: 30 },
    ];
    // (2 * 50) + (3 * 30) = 100 + 90 = 190
    expect(calculateSubtotal(items)).toBe(190);
  });

  test("returns 0 for empty items array", () => {
    expect(calculateSubtotal([])).toBe(0);
  });

  test("handles floating point values with correct rounding", () => {
    const items = [
      { quantity: 3, unitPrice: 19.99 },
      { quantity: 2, unitPrice: 4.5 },
    ];
    // (3 * 19.99) + (2 * 4.5) = 59.97 + 9 = 68.97
    expect(calculateSubtotal(items)).toBe(68.97);
  });

  test("ignores invalid or zero-quantity items safely", () => {
    const items = [
      { quantity: 2, unitPrice: 50 },
      { quantity: -1, unitPrice: 50 },
      { quantity: 0, unitPrice: 50 },
      { quantity: "abc", unitPrice: 50 },
      null,
    ];
    expect(calculateSubtotal(items)).toBe(100);
  });

  test("returns 0 for non-array inputs", () => {
    expect(calculateSubtotal(null)).toBe(0);
    expect(calculateSubtotal(undefined)).toBe(0);
    expect(calculateSubtotal("invalid")).toBe(0);
  });
});

describe("calculateTax()", () => {
  test("calculates tax percentage correctly", () => {
    // 10% tax on 100 = 10
    expect(calculateTax(100, 10)).toBe(10);
    // 18% tax on 250 = 45
    expect(calculateTax(250, 18)).toBe(45);
  });

  test("returns 0 when tax rate is 0", () => {
    expect(calculateTax(100, 0)).toBe(0);
  });

  test("handles fractional tax rates correctly", () => {
    // 8.5% tax on 100 = 8.5
    expect(calculateTax(100, 8.5)).toBe(8.5);
  });

  test("returns 0 for negative or invalid inputs", () => {
    expect(calculateTax(-100, 10)).toBe(0);
    expect(calculateTax(100, -5)).toBe(0);
    expect(calculateTax("invalid", 10)).toBe(0);
    expect(calculateTax(100, "invalid")).toBe(0);
  });
});

describe("calculateDiscount()", () => {
  test("calculates percentage discount correctly", () => {
    // 10% of 200 = 20
    expect(calculateDiscount(200, 10)).toBe(20);
  });

  test("caps discount at maximum allowable discount if provided", () => {
    // 20% of 1000 = 200, capped at maxDiscount 100
    expect(calculateDiscount(1000, 20, 100)).toBe(100);
  });

  test("caps discount at subtotal (cannot exceed total value)", () => {
    // 150% discount capped at subtotal
    expect(calculateDiscount(100, 150)).toBe(100);
  });

  test("returns 0 for 0% discount", () => {
    expect(calculateDiscount(100, 0)).toBe(0);
  });

  test("returns 0 for invalid inputs", () => {
    expect(calculateDiscount(-100, 10)).toBe(0);
    expect(calculateDiscount(100, -5)).toBe(0);
    expect(calculateDiscount("abc", 10)).toBe(0);
  });
});

describe("calculateOrderTotal()", () => {
  test("calculates total = subtotal + tax - discount", () => {
    // subtotal = 1000, tax = 100, discount = 50 -> 1050
    expect(calculateOrderTotal(1000, 100, 50)).toBe(1050);
  });

  test("calculates total with zero tax and zero discount", () => {
    expect(calculateOrderTotal(500, 0, 0)).toBe(500);
    expect(calculateOrderTotal(500)).toBe(500);
  });

  test("prevents negative order total if discount exceeds subtotal + tax", () => {
    // subtotal = 100, discount = 150 -> total should be 0, not -50
    expect(calculateOrderTotal(100, 0, 150)).toBe(0);
  });

  test("handles invalid inputs gracefully", () => {
    expect(calculateOrderTotal(-100, 10, 0)).toBe(0);
    expect(calculateOrderTotal("invalid", 10, 0)).toBe(0);
    expect(calculateOrderTotal(100, "abc", "xyz")).toBe(100);
  });
});

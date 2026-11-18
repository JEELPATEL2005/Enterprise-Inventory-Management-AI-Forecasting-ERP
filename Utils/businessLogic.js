/**
 * Core business calculation and validation utilities.
 * Encapsulates reusable business rules for inventory and order management.
 */

/**
 * Calculate available stock from physical quantity and reserved stock.
 * Business rule: availableStock = quantity - reservedStock (clamped to >= 0)
 */
function calculateAvailableStock(quantity, reservedStock = 0) {
  const qty = Number(quantity);
  const reserved = Number(reservedStock);

  if (isNaN(qty) || isNaN(reserved)) {
    return 0;
  }
  if (qty < 0 || reserved < 0) {
    return 0;
  }
  return Math.max(0, qty - reserved);
}

/**
 * Validate if requested quantity is valid (positive integer > 0).
 */
function validateQuantity(quantity) {
  if (quantity === null || quantity === undefined) {
    return { valid: false, error: "Quantity is required" };
  }
  const qty = Number(quantity);
  if (isNaN(qty)) {
    return { valid: false, error: "Quantity must be a valid number" };
  }
  if (!Number.isFinite(qty)) {
    return { valid: false, error: "Quantity must be finite" };
  }
  if (qty <= 0) {
    return { valid: false, error: "Quantity must be greater than zero" };
  }
  if (!Number.isInteger(qty)) {
    return { valid: false, error: "Quantity must be an integer" };
  }
  return { valid: true, error: null };
}

/**
 * Validate if available stock is sufficient for requested quantity.
 */
function validateStockAvailability(availableStock, requestedQuantity) {
  const validQty = validateQuantity(requestedQuantity);
  if (!validQty.valid) {
    return { available: false, error: validQty.error };
  }

  const stock = Number(availableStock);
  if (isNaN(stock) || stock < 0) {
    return { available: false, error: "Invalid available stock" };
  }

  if (stock < requestedQuantity) {
    return {
      available: false,
      error: `Insufficient stock: requested ${requestedQuantity}, available ${stock}`,
    };
  }

  return { available: true, error: null };
}

/**
 * Calculate order subtotal from line items.
 * Each item should have { quantity, unitPrice }
 */
function calculateSubtotal(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  let subtotal = 0;
  for (const item of items) {
    if (!item) continue;
    const qty = Number(item.quantity);
    const price = Number(item.unitPrice);
    if (!isNaN(qty) && !isNaN(price) && qty > 0 && price >= 0) {
      subtotal += qty * price;
    }
  }
  return Number(subtotal.toFixed(2));
}

/**
 * Calculate tax based on subtotal and tax percentage rate.
 */
function calculateTax(subtotal, taxRate = 0) {
  const sub = Number(subtotal);
  const rate = Number(taxRate);

  if (isNaN(sub) || isNaN(rate) || sub <= 0 || rate <= 0) {
    return 0;
  }
  return Number(((sub * rate) / 100).toFixed(2));
}

/**
 * Calculate discount based on subtotal and discount rate or amount.
 */
function calculateDiscount(subtotal, discountRate = 0, maxDiscount = Infinity) {
  const sub = Number(subtotal);
  const rate = Number(discountRate);
  const max = Number(maxDiscount);

  if (isNaN(sub) || isNaN(rate) || sub <= 0 || rate <= 0) {
    return 0;
  }
  const discount = (sub * rate) / 100;
  return Number(Math.min(discount, isNaN(max) ? discount : max, sub).toFixed(2));
}

/**
 * Calculate final order total = subtotal + tax - discount (clamped to >= 0)
 */
function calculateOrderTotal(subtotal, tax = 0, discount = 0) {
  const sub = Number(subtotal);
  const t = Number(tax);
  const d = Number(discount);

  if (isNaN(sub) || sub < 0) return 0;
  const safeTax = isNaN(t) || t < 0 ? 0 : t;
  const safeDisc = isNaN(d) || d < 0 ? 0 : d;

  return Number(Math.max(0, sub + safeTax - safeDisc).toFixed(2));
}

module.exports = {
  calculateAvailableStock,
  validateQuantity,
  validateStockAvailability,
  calculateSubtotal,
  calculateTax,
  calculateDiscount,
  calculateOrderTotal,
};

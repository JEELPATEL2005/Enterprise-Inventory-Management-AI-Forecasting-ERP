const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/inventory";

async function seedSalesHistory() {
  console.log("Connecting to MongoDB:", MONGO_URI);
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  const productColl = db.collection("products");
  const warehouseColl = db.collection("warehouses");
  const salesOrderColl = db.collection("salesorders");
  const stockMovementColl = db.collection("stockmovements");
  const inventoryColl = db.collection("inventories");
  const customerColl = db.collection("customers");
  const employeeColl = db.collection("employees");

  // Find products & warehouses
  const laptop = await productColl.findOne({ sku: "LAP-001" });
  const enterpriseLaptop = await productColl.findOne({ sku: "TEST-SKU-999" });
  const mainWarehouse = await warehouseColl.findOne({ warehouseName: /Main Warehouse/i });
  const miniWarehouse = await warehouseColl.findOne({ warehouseName: /Mini warehouse/i });
  const customer = await customerColl.findOne({});
  const employee = await employeeColl.findOne({});

  if (!laptop || !mainWarehouse) {
    console.error("Required seed product or warehouse not found!");
    process.exit(1);
  }

  console.log(`Seeding data for Product: ${laptop.productName} (${laptop._id}) in ${mainWarehouse.warehouseName} (${mainWarehouse._id})`);

  // Target products & warehouse configurations
  const seedConfigs = [
    {
      product: laptop,
      warehouse: mainWarehouse,
      days: 120,
      baseSales: 12,
      variance: 6,
      weekendReduction: 0.5,
    },
    {
      product: laptop,
      warehouse: miniWarehouse || mainWarehouse,
      days: 120,
      baseSales: 5,
      variance: 3,
      weekendReduction: 0.6,
    },
  ];

  if (enterpriseLaptop) {
    seedConfigs.push({
      product: enterpriseLaptop,
      warehouse: mainWarehouse,
      days: 90,
      baseSales: 8,
      variance: 4,
      weekendReduction: 0.4,
    });
  }

  const now = new Date();
  let totalOrdersCreated = 0;
  let totalMovementsCreated = 0;

  for (const config of seedConfigs) {
    const { product, warehouse, days, baseSales, variance, weekendReduction } = config;

    // Check if we already seeded extensive history for this pair
    const existingCount = await stockMovementColl.countDocuments({
      product: product._id,
      warehouse: warehouse._id,
      type: "STOCK_OUT",
      referenceType: "SALE",
    });

    if (existingCount >= 60) {
      console.log(`Product ${product.productName} at ${warehouse.warehouseName} already has ${existingCount} sales movements. Skipping seed.`);
      continue;
    }

    console.log(`Generating ${days} days of realistic sales for ${product.productName} at ${warehouse.warehouseName}...`);

    for (let i = days; i >= 1; i--) {
      const orderDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      // Set to business hour 10:00 - 18:00
      orderDate.setHours(10 + (i % 8), (i * 7) % 60, 0, 0);

      const dayOfWeek = orderDate.getDay(); // 0 is Sunday, 6 is Saturday
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      // Realistic pseudo-random daily sales with weekly seasonality
      const noise = (Math.sin(i * 0.4) * variance) + ((Math.random() - 0.5) * variance);
      let dailyQty = Math.round(baseSales + noise);
      if (isWeekend) {
        dailyQty = Math.round(dailyQty * weekendReduction);
      }
      dailyQty = Math.max(1, dailyQty); // at least 1 unit or zero periodically

      const orderNumber = `SO-SEED-${Date.now().toString(36).toUpperCase()}-${i}-${Math.floor(Math.random() * 900 + 100)}`;
      const unitPrice = product.unitPrice || 45000;

      // Create Sales Order
      const salesOrderDoc = {
        salesOrderNumber: orderNumber,
        customer: customer ? customer._id : new mongoose.Types.ObjectId(),
        warehouse: warehouse._id,
        status: "DELIVERED",
        items: [
          {
            product: product._id,
            quantity: dailyQty,
            unitPrice: unitPrice,
            totalPrice: dailyQty * unitPrice,
          },
        ],
        totalAmount: dailyQty * unitPrice,
        createdBy: employee ? employee._id : null,
        createdAt: orderDate,
        updatedAt: orderDate,
      };

      const soRes = await salesOrderColl.insertOne(salesOrderDoc);
      totalOrdersCreated++;

      // Create matching Stock Movement representing physical dispatch
      const movementDoc = {
        product: product._id,
        warehouse: warehouse._id,
        type: "STOCK_OUT",
        quantity: dailyQty,
        referenceType: "SALE",
        referenceId: soRes.insertedId,
        performedBy: employee ? employee._id : null,
        notes: `Dispatched sales order ${orderNumber}`,
        createdAt: orderDate,
        updatedAt: orderDate,
      };

      await stockMovementColl.insertOne(movementDoc);
      totalMovementsCreated++;
    }

    // Ensure inventory record exists with adequate stock
    const invExists = await inventoryColl.findOne({
      product: product._id,
      warehouse: warehouse._id,
    });

    if (!invExists) {
      await inventoryColl.insertOne({
        warehouse: warehouse._id,
        product: product._id,
        quantity: 150,
        reservedStock: 15,
        reorderPoint: 40,
        reorderLevel: 30,
        safetyStock: 15,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`Initialized inventory record for ${product.productName} at ${warehouse.warehouseName}`);
    } else {
      // Ensure positive on-hand quantity
      await inventoryColl.updateOne(
        { _id: invExists._id },
        {
          $set: {
            quantity: Math.max(invExists.quantity, 120),
            reservedStock: Math.min(invExists.reservedStock || 10, 20),
            safetyStock: invExists.safetyStock || 15,
            reorderPoint: invExists.reorderPoint || 40,
          },
        }
      );
    }
  }

  console.log(`Seeding complete! Created ${totalOrdersCreated} SalesOrders and ${totalMovementsCreated} StockMovements.`);
  await mongoose.disconnect();
}

seedSalesHistory().catch((err) => {
  console.error("Seeding error:", err);
  process.exit(1);
});

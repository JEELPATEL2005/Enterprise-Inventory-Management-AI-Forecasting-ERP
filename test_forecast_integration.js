require("dotenv").config();
const { generateAccessToken } = require("./services/authService");
const mongoose = require("mongoose");
const http = require("http");

const BASE_URL = "http://127.0.0.1:3000";

// Helper to make HTTP requests
function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log("=== STARTING DEMAND FORECAST INTEGRATION TESTS ===\n");

  // Connect to DB to get user, product, warehouse IDs
  await mongoose.connect("mongodb://127.0.0.1:27017/inventory");
  const db = mongoose.connection.db;

  const adminUser = await db.collection("employees").findOne({ email: "admin@example.com" });
  const laptop = await db.collection("products").findOne({ sku: "LAP-001" });
  const sparseProduct = await db.collection("products").findOne({ sku: "SKU-1790501469770" });
  const mainWh = await db.collection("warehouses").findOne({ warehouseName: /Main Warehouse/i });
  const miniWh = await db.collection("warehouses").findOne({ warehouseName: /Mini warehouse/i });

  console.log("Admin User:", adminUser ? adminUser.email : "Not Found");
  console.log("Laptop Product ID:", laptop?._id);
  console.log("Sparse Product ID:", sparseProduct?._id);
  console.log("Main Warehouse ID:", mainWh?._id);

  // Find role
  const superAdminRole = await db.collection("roles").findOne({ roleName: /SUPER_ADMIN/i }) || { roleName: "SUPER_ADMIN" };
  const warehouseManagerRole = await db.collection("roles").findOne({ roleName: /WAREHOUSE_MANAGER/i }) || { roleName: "WAREHOUSE_MANAGER" };

  // Ensure admin user has ACTIVE status
  await db.collection("employees").updateOne({ _id: adminUser._id }, { $set: { status: "ACTIVE" } });

  // Generate tokens for test roles using real authService
  const adminToken = generateAccessToken(adminUser, superAdminRole, ["ALL"]);

  // Create a dummy warehouse manager employee in DB so findById succeeds
  let wmEmployee = await db.collection("employees").findOne({ email: "wm_test@example.com" });
  if (!wmEmployee) {
    const wmRes = await db.collection("employees").insertOne({
      name: "Warehouse Manager",
      email: "wm_test@example.com",
      status: "ACTIVE",
      assignedWarehouses: [mainWh._id],
      role: warehouseManagerRole._id,
      createdAt: new Date(),
    });
    wmEmployee = await db.collection("employees").findOne({ _id: wmRes.insertedId });
  } else {
    await db.collection("employees").updateOne({ _id: wmEmployee._id }, { $set: { status: "ACTIVE", assignedWarehouses: [mainWh._id] } });
  }

  const warehouseManagerToken = generateAccessToken(wmEmployee, warehouseManagerRole, ["WAREHOUSE_VIEW"]);

  // 1. Health check
  console.log("\n[TEST 1] Testing GET /api/forecast/health...");
  const healthRes = await makeRequest("GET", "/api/forecast/health", null, adminToken);
  console.log("Status:", healthRes.status, "Health:", healthRes.body?.data?.status);

  // 2. Predict with Sufficient History (XGBoost)
  console.log("\n[TEST 2] Testing POST /api/forecast/predict (7-Day XGBoost)...");
  const pred7Res = await makeRequest(
    "POST",
    "/api/forecast/predict",
    {
      productId: laptop._id.toString(),
      horizonDays: 7,
    },
    adminToken
  );
  console.log("Status:", pred7Res.status);
  console.log("Product:", pred7Res.body?.data?.product_name);
  console.log("Horizon Days:", pred7Res.body?.data?.horizon_days);
  console.log("Total Predicted Demand:", pred7Res.body?.data?.total_predicted_demand);
  console.log("Model Type:", pred7Res.body?.data?.model_type);
  console.log("Model Status:", pred7Res.body?.data?.status);
  console.log("XGBoost RMSE:", pred7Res.body?.data?.metrics?.rmse, "Baseline RMSE:", pred7Res.body?.data?.metrics?.baseline_rmse);
  console.log("Reorder Recommended:", pred7Res.body?.data?.inventory_snapshot?.is_reorder_recommended);

  // 3. Multi-Horizon Forecasts (15 and 30 Days)
  console.log("\n[TEST 3] Testing POST /api/forecast/predict (15-Day and 30-Day Horizons)...");
  const pred15Res = await makeRequest(
    "POST",
    "/api/forecast/predict",
    {
      productId: laptop._id.toString(),
      horizonDays: 15,
    },
    adminToken
  );
  console.log("15-Day Total Demand:", pred15Res.body?.data?.total_predicted_demand);

  const pred30Res = await makeRequest(
    "POST",
    "/api/forecast/predict",
    {
      productId: laptop._id.toString(),
      horizonDays: 30,
    },
    adminToken
  );
  console.log("30-Day Total Demand:", pred30Res.body?.data?.total_predicted_demand);

  // 4. Predict with Insufficient History (Fallback)
  console.log("\n[TEST 4] Testing POST /api/forecast/predict (Sparse Product Fallback)...");
  if (sparseProduct) {
    const sparseRes = await makeRequest(
      "POST",
      "/api/forecast/predict",
      {
        productId: sparseProduct._id.toString(),
        horizonDays: 7,
      },
      adminToken
    );
    console.log("Status:", sparseRes.status);
    console.log("Model Type:", sparseRes.body?.data?.model_type);
    console.log("Model Status:", sparseRes.body?.data?.status);
    console.log("Notes:", sparseRes.body?.data?.notes);
  }

  // 5. Warehouse-specific prediction
  console.log("\n[TEST 5] Testing POST /api/forecast/predict for specific warehouse...");
  const whPredRes = await makeRequest(
    "POST",
    "/api/forecast/predict",
    {
      productId: laptop._id.toString(),
      warehouseId: mainWh._id.toString(),
      horizonDays: 7,
    },
    adminToken
  );
  console.log("Main Warehouse Demand:", whPredRes.body?.data?.total_predicted_demand);
  console.log("Warehouse Name:", whPredRes.body?.data?.warehouse_name);

  // 6. Model Metrics
  console.log("\n[TEST 6] Testing GET /api/forecast/metrics...");
  const metricsRes = await makeRequest("GET", "/api/forecast/metrics", null, adminToken);
  console.log("Status:", metricsRes.status);
  console.log("Total Models Available:", metricsRes.body?.data?.total_models);
  console.log("Health:", metricsRes.body?.data?.system_health);

  // 7. Forecast History
  console.log("\n[TEST 7] Testing GET /api/forecast/history...");
  const historyRes = await makeRequest(
    "GET",
    `/api/forecast/history?productId=${laptop._id.toString()}&limit=5`,
    null,
    adminToken
  );
  console.log("Status:", historyRes.status);
  console.log("Retrieved History Records Count:", historyRes.body?.data?.length);

  // 8. Security & RBAC Checks
  console.log("\n[TEST 8] Testing RBAC & Unauthorized Access...");
  // Unauthorized token (no token)
  const noTokenRes = await makeRequest("GET", "/api/forecast/metrics");
  console.log("No token request status:", noTokenRes.status, "(Expected 401)");

  // Warehouse manager requesting unassigned warehouse
  if (miniWh) {
    const unauthWhRes = await makeRequest(
      "POST",
      "/api/forecast/predict",
      {
        productId: laptop._id.toString(),
        warehouseId: miniWh._id.toString(),
        horizonDays: 7,
      },
      warehouseManagerToken
    );
    console.log("Unassigned warehouse request status:", unauthWhRes.status, "(Expected 403)");
  }

  console.log("\n=== ALL INTEGRATION TESTS FINISHED ===");
  await mongoose.disconnect();
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

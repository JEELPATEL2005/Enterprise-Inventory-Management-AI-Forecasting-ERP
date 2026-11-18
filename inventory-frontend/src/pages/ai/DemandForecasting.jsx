import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import {
  TrendingUp,
  BrainCircuit,
  Warehouse,
  Package,
  Calendar,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ShoppingCart,
  Boxes,
  ArrowRight,
  Info,
  BarChart3,
  LineChart as LineChartIcon,
  HelpCircle,
  Zap,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Area,
} from "recharts";
import forecastApi from "../../api/forecastApi";
import Toast from "../../components/common/Toast";

const DemandForecasting = () => {
  const { user } = useSelector((state) => state.auth);

  // Filter state
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [horizonDays, setHorizonDays] = useState(7);

  // Service & Forecast state
  const [serviceHealth, setServiceHealth] = useState(null);
  const [forecastData, setForecastData] = useState(null);
  const [historyRecords, setHistoryRecords] = useState([]);
  const [chartViewMode, setChartViewMode] = useState("area"); // 'area' or 'bar'

  // Loading & notification states
  const [isLoading, setIsLoading] = useState(false);
  const [isRetraining, setIsRetraining] = useState(false);
  const [toast, setToast] = useState(null);

  // Initial load: Fetch product list, warehouses, and health
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const [prodRes, whRes, healthRes] = await Promise.allSettled([
        forecastApi.getProducts(),
        forecastApi.getWarehouses(),
        forecastApi.getHealth(),
      ]);

      if (prodRes.status === "fulfilled" && prodRes.value.success) {
        const prodList = prodRes.value.data || [];
        setProducts(prodList);
        // Default to first product if available
        if (prodList.length > 0) {
          // Prefer laptop if available
          const defaultProd = prodList.find((p) => p.sku === "LAP-001") || prodList[0];
          setSelectedProduct(defaultProd._id);
        }
      }

      if (whRes.status === "fulfilled" && whRes.value.success) {
        setWarehouses(whRes.value.data || []);
      }

      if (healthRes.status === "fulfilled" && healthRes.value.success) {
        setServiceHealth(healthRes.value.data);
      }
    } catch (err) {
      console.error("Failed to load initial forecast metadata:", err);
    }
  };

  // Trigger forecast whenever product, warehouse, or horizon changes
  useEffect(() => {
    if (selectedProduct) {
      handleGenerateForecast(false);
    }
  }, [selectedProduct, selectedWarehouse, horizonDays]);

  const handleGenerateForecast = async (showSuccessToast = true) => {
    if (!selectedProduct) return;
    setIsLoading(true);
    try {
      const res = await forecastApi.predictDemand({
        productId: selectedProduct,
        warehouseId: selectedWarehouse || null,
        horizonDays,
      });

      if (res.success && res.data) {
        setForecastData(res.data);
        if (showSuccessToast) {
          setToast({
            type: "success",
            message: `${res.data.horizon_days}-day demand forecast generated successfully!`,
          });
        }
        // Fetch recent history
        loadHistory(selectedProduct, selectedWarehouse);
      } else {
        throw new Error(res.message || "Failed to generate forecast.");
      }
    } catch (err) {
      console.error("Prediction error:", err);
      const errMsg = err.response?.data?.message || err.message || "Error contacting ML forecasting service.";
      setToast({ type: "error", message: errMsg });
    } finally {
      setIsLoading(false);
    }
  };

  const loadHistory = async (prodId, whId) => {
    try {
      const histRes = await forecastApi.getHistory({
        productId: prodId,
        warehouseId: whId || null,
        limit: 8,
      });
      if (histRes.success && histRes.data) {
        setHistoryRecords(histRes.data);
      }
    } catch (err) {
      console.warn("Could not load forecast history:", err);
    }
  };

  const handleRetrain = async () => {
    if (!selectedProduct) return;
    setIsRetraining(true);
    try {
      const res = await forecastApi.trainModels({
        productId: selectedProduct,
        warehouseId: selectedWarehouse || null,
        forceRetrain: true,
      });

      if (res.success) {
        setToast({
          type: "success",
          message: `Model retraining completed. Status: ${res.data.status}`,
        });
        // Refresh forecast
        handleGenerateForecast(false);
      }
    } catch (err) {
      const errMsg = err.response?.data?.message || err.message || "Retraining request failed.";
      setToast({ type: "error", message: errMsg });
    } finally {
      setIsRetraining(false);
    }
  };

  // Prepare combined time-series data for Recharts
  const buildCombinedChartData = () => {
    if (!forecastData) return [];

    const historical = (forecastData.historical_sales_data || []).map((item) => ({
      date: item.date,
      actualSales: item.actualQuantity,
      predictedDemand: null,
      type: "Historical",
    }));

    const forecast = (forecastData.daily_forecasts || []).map((item) => ({
      date: item.date,
      actualSales: null,
      predictedDemand: item.predictedQuantity,
      type: "Forecast",
    }));

    // Bridge the gap between last actual and first forecast for continuous line visualization
    if (historical.length > 0 && forecast.length > 0) {
      const lastHist = historical[historical.length - 1];
      // Attach anchor to first forecast point
      forecast[0].actualSales = lastHist.actualSales;
    }

    return [...historical, ...forecast];
  };

  const chartData = buildCombinedChartData();
  const snapshot = forecastData?.inventory_snapshot;
  const metrics = forecastData?.metrics;
  const isFallback = forecastData?.status === "FALLBACK_INSUFFICIENT_HISTORY";

  return (
    <div className="forecast-dashboard" style={{ padding: "24px 32px", maxWidth: "1600px", margin: "0 auto" }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* 1. Header & Microservice Health Status */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                backgroundColor: "#e0e7ff",
                color: "#4f46e5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BrainCircuit size={22} />
            </div>
            <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
              AI Demand Forecasting
            </h1>
            <span
              style={{
                backgroundColor: "#f1f5f9",
                color: "#475569",
                fontSize: "12px",
                fontWeight: "600",
                padding: "3px 10px",
                borderRadius: "20px",
                border: "1px solid #cbd5e1",
              }}
            >
              XGBoost Regressor
            </span>
          </div>
          <p style={{ color: "#64748b", fontSize: "14px", margin: 0 }}>
            Recursive multi-step machine learning engine predicting consumer demand based on historical dispatch records.
          </p>
        </div>

        {/* Microservice Live Status Pill */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "8px",
              backgroundColor: serviceHealth?.status === "healthy" ? "#ecfdf5" : "#fff1f2",
              border: `1px solid ${serviceHealth?.status === "healthy" ? "#a7f3d0" : "#fecdd3"}`,
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: serviceHealth?.status === "healthy" ? "#10b981" : "#f43f5e",
                boxShadow: `0 0 6px ${serviceHealth?.status === "healthy" ? "#10b981" : "#f43f5e"}`,
              }}
            />
            <span
              style={{
                fontSize: "12px",
                fontWeight: "600",
                color: serviceHealth?.status === "healthy" ? "#065f46" : "#9f1239",
              }}
            >
              {serviceHealth?.status === "healthy"
                ? `ML Engine Active (v${serviceHealth.version || "1.0"})`
                : "ML Service Disconnected"}
            </span>
          </div>

          <button
            onClick={handleRetrain}
            disabled={isRetraining || isLoading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              backgroundColor: "#ffffff",
              border: "1px solid #cbd5e1",
              color: "#334155",
              fontSize: "13px",
              fontWeight: "600",
              cursor: isRetraining ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
            }}
          >
            <RefreshCw size={14} className={isRetraining ? "animate-spin" : ""} />
            <span>{isRetraining ? "Retraining Model..." : "Retrain Model"}</span>
          </button>
        </div>
      </div>

      {/* 2. Interactive Forecast Controls Filter Bar */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          padding: "18px 24px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          border: "1px solid #e2e8f0",
          marginBottom: "24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "18px",
          alignItems: "end",
        }}
      >
        {/* Product Dropdown */}
        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#475569", marginBottom: "6px" }}>
            <Package size={13} style={{ display: "inline", marginRight: "4px" }} />
            Select Product
          </label>
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              fontSize: "13.5px",
              color: "#0f172a",
              backgroundColor: "#ffffff",
              outline: "none",
            }}
          >
            {products.map((p) => (
              <option key={p._id} value={p._id}>
                {p.productName} ({p.sku || "No SKU"})
              </option>
            ))}
          </select>
        </div>

        {/* Warehouse Dropdown */}
        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#475569", marginBottom: "6px" }}>
            <Warehouse size={13} style={{ display: "inline", marginRight: "4px" }} />
            Target Warehouse
          </label>
          <select
            value={selectedWarehouse}
            onChange={(e) => setSelectedWarehouse(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: "8px",
              border: "1px solid #cbd5e1",
              fontSize: "13.5px",
              color: "#0f172a",
              backgroundColor: "#ffffff",
              outline: "none",
            }}
          >
            <option value="">All Warehouses (Global Enterprise Aggregate)</option>
            {warehouses.map((w) => (
              <option key={w._id} value={w._id}>
                {w.warehouseName} ({w.location || "Default"})
              </option>
            ))}
          </select>
        </div>

        {/* Forecast Horizon Pills */}
        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#475569", marginBottom: "6px" }}>
            <Calendar size={13} style={{ display: "inline", marginRight: "4px" }} />
            Forecast Horizon
          </label>
          <div style={{ display: "flex", gap: "6px" }}>
            {[7, 15, 30].map((days) => (
              <button
                key={days}
                onClick={() => setHorizonDays(days)}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  border: horizonDays === days ? "1px solid #4f46e5" : "1px solid #cbd5e1",
                  backgroundColor: horizonDays === days ? "#eef2ff" : "#ffffff",
                  color: horizonDays === days ? "#4338ca" : "#475569",
                  transition: "all 0.15s ease",
                }}
              >
                {days} Days
              </button>
            ))}
          </div>
        </div>

        {/* Generate / Refresh Forecast Button */}
        <div>
          <button
            onClick={() => handleGenerateForecast(true)}
            disabled={isLoading || !selectedProduct}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: "8px",
              backgroundColor: "#4f46e5",
              color: "#ffffff",
              border: "none",
              fontSize: "13.5px",
              fontWeight: "600",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              boxShadow: "0 2px 4px rgba(79, 70, 229, 0.25)",
            }}
          >
            <Zap size={15} />
            <span>{isLoading ? "Forecasting Demand..." : "Run ML Forecast"}</span>
          </button>
        </div>
      </div>

      {/* 3. Fallback Warning or Optimal Performance Banner */}
      {isFallback ? (
        <div
          style={{
            backgroundColor: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: "10px",
            padding: "14px 18px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <AlertTriangle color="#d97706" size={22} style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#92400e" }}>
              Insufficient Historical Sales for XGBoost Training
            </div>
            <div style={{ fontSize: "13px", color: "#b45309" }}>
              {forecastData.notes ||
                "This product has fewer than 35 days of recorded dispatches. To prevent misleading predictions, the system automatically engaged the validated Moving Average baseline fallback."}
            </div>
          </div>
        </div>
      ) : forecastData && (
        <div
          style={{
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "12px 18px",
            marginBottom: "24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <CheckCircle2 color="#10b981" size={18} />
            <span style={{ fontSize: "13.5px", fontWeight: "600", color: "#1e293b" }}>
              Model: {forecastData.model_type} v{forecastData.model_version}
            </span>
            <span style={{ color: "#94a3b8" }}>•</span>
            <span style={{ fontSize: "13px", color: "#64748b" }}>
              Trained on chronological non-leaking sales series
            </span>
          </div>

          {metrics && (
            <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "12.5px" }}>
              <div>
                <span style={{ color: "#64748b" }}>XGBoost RMSE: </span>
                <span style={{ fontWeight: "700", color: "#0f172a" }}>{metrics.rmse ?? "N/A"}</span>
                {metrics.baseline_rmse && (
                  <span style={{ color: "#10b981", marginLeft: "4px" }}>
                    (vs Baseline: {metrics.baseline_rmse})
                  </span>
                )}
              </div>
              <div style={{ borderLeft: "1px solid #cbd5e1", height: "14px" }} />
              <div>
                <span style={{ color: "#64748b" }}>MAE: </span>
                <span style={{ fontWeight: "700", color: "#0f172a" }}>{metrics.mae ?? "N/A"}</span>
              </div>
              <div style={{ borderLeft: "1px solid #cbd5e1", height: "14px" }} />
              <div>
                <span style={{ color: "#64748b" }}>WAPE: </span>
                <span style={{ fontWeight: "700", color: "#0f172a" }}>
                  {metrics.wape ? `${metrics.wape}%` : "N/A"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Business Inventory & Reorder Decision Cards */}
      {snapshot && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          {/* Card 1: Predicted Total Demand */}
          <div
            style={{
              backgroundColor: "#ffffff",
              padding: "18px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: "600" }}>
              <span>PREDICTED DEMAND</span>
              <TrendingUp size={16} color="#4f46e5" />
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#4f46e5", margin: "6px 0 2px" }}>
              {forecastData.total_predicted_demand}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Avg {forecastData.average_daily_demand} units/day over {forecastData.horizon_days}d
            </div>
          </div>

          {/* Card 2: Current Physical & Available Stock */}
          <div
            style={{
              backgroundColor: "#ffffff",
              padding: "18px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: "600" }}>
              <span>CURRENT AVAILABLE STOCK</span>
              <Boxes size={16} color="#059669" />
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", margin: "6px 0 2px" }}>
              {snapshot.available_stock}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Physical {snapshot.current_physical_stock} units ({snapshot.reserved_stock} reserved)
            </div>
          </div>

          {/* Card 3: Expected Future Stock */}
          <div
            style={{
              backgroundColor: "#ffffff",
              padding: "18px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: "600" }}>
              <span>PROJECTED FUTURE STOCK</span>
              <Clock size={16} color="#0284c7" />
            </div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: "800",
                color: snapshot.expected_future_stock <= snapshot.reorder_point ? "#dc2626" : "#0284c7",
                margin: "6px 0 2px",
              }}
            >
              {snapshot.expected_future_stock}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              After {forecastData.horizon_days}d demand deduction
            </div>
          </div>

          {/* Card 4: Reorder Point */}
          <div
            style={{
              backgroundColor: "#ffffff",
              padding: "18px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "12px", fontWeight: "600" }}>
              <span>REORDER THRESHOLD</span>
              <ShieldCheck size={16} color="#d97706" />
            </div>
            <div style={{ fontSize: "26px", fontWeight: "800", color: "#0f172a", margin: "6px 0 2px" }}>
              {snapshot.reorder_point}
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Lead time {snapshot.lead_time_days}d + {snapshot.safety_stock} safety buffer
            </div>
          </div>

          {/* Card 5: Reorder Recommendation Decision */}
          <div
            style={{
              backgroundColor: snapshot.is_reorder_recommended ? "#fff1f2" : "#f0fdf4",
              padding: "18px 20px",
              borderRadius: "12px",
              border: `1px solid ${snapshot.is_reorder_recommended ? "#fecdd3" : "#bbf7d0"}`,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: snapshot.is_reorder_recommended ? "#9f1239" : "#166534",
                fontSize: "12px",
                fontWeight: "700",
              }}
            >
              <span>PROCUREMENT ACTION</span>
              <ShoppingCart size={16} color={snapshot.is_reorder_recommended ? "#e11d48" : "#16a34a"} />
            </div>
            <div
              style={{
                fontSize: "22px",
                fontWeight: "800",
                color: snapshot.is_reorder_recommended ? "#be123c" : "#15803d",
                margin: "6px 0 2px",
              }}
            >
              {snapshot.is_reorder_recommended
                ? `Reorder +${snapshot.suggested_reorder_quantity} Units`
                : "Stock Levels Safe"}
            </div>
            <div style={{ fontSize: "12px", color: snapshot.is_reorder_recommended ? "#9f1239" : "#166534" }}>
              {snapshot.is_reorder_recommended
                ? "Immediate purchase order suggested"
                : "Projected stock exceeds minimum reorder point"}
            </div>
          </div>
        </div>
      )}

      {/* 5. Main Forecasting Comparison Chart */}
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          padding: "24px",
          border: "1px solid #e2e8f0",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: "0 0 4px" }}>
              Historical Actual Sales vs. Predicted Future Demand
            </h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              Chronological daily dispatches grounded in MongoDB StockMovements paired with recursive multi-step ML forecasts.
            </p>
          </div>

          {/* Chart View Toggle */}
          <div style={{ display: "flex", gap: "4px", backgroundColor: "#f1f5f9", padding: "3px", borderRadius: "8px" }}>
            <button
              onClick={() => setChartViewMode("area")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "600",
                border: "none",
                cursor: "pointer",
                backgroundColor: chartViewMode === "area" ? "#ffffff" : "transparent",
                color: chartViewMode === "area" ? "#4f46e5" : "#64748b",
                boxShadow: chartViewMode === "area" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <LineChartIcon size={14} />
              Area / Line
            </button>
            <button
              onClick={() => setChartViewMode("bar")}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "600",
                border: "none",
                cursor: "pointer",
                backgroundColor: chartViewMode === "bar" ? "#ffffff" : "transparent",
                color: chartViewMode === "bar" ? "#4f46e5" : "#64748b",
                boxShadow: chartViewMode === "bar" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <BarChart3 size={14} />
              Bar Comparison
            </button>
          </div>
        </div>

        {/* Chart Container */}
        <div style={{ width: "100%", height: 380 }}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 25 }}>
                <defs>
                  <linearGradient id="actualSalesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="predictedDemandGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={{ stroke: "#e2e8f0" }}
                  label={{ value: "Units", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 12 }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div
                          style={{
                            backgroundColor: "#1e293b",
                            color: "#ffffff",
                            padding: "10px 14px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                          }}
                        >
                          <div style={{ fontWeight: "700", marginBottom: "4px" }}>Date: {label}</div>
                          {data.actualSales !== null && data.actualSales !== undefined && (
                            <div style={{ color: "#60a5fa" }}>
                              Actual Historical Dispatches: <b>{data.actualSales} units</b>
                            </div>
                          )}
                          {data.predictedDemand !== null && data.predictedDemand !== undefined && (
                            <div style={{ color: "#fbbf24" }}>
                              ML Forecast Demand: <b>{data.predictedDemand} units</b>
                            </div>
                          )}
                          <div style={{ color: "#94a3b8", marginTop: "4px", fontSize: "11px" }}>
                            Segment: {data.type}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{ paddingBottom: "10px", fontSize: "12px" }}
                />

                {/* Vertical demarcation separating historical sales from forecast */}
                {forecastData.forecast_date && (
                  <ReferenceLine
                    x={forecastData.forecast_date}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{
                      value: "Forecast Start",
                      fill: "#ef4444",
                      fontSize: 11,
                      position: "top",
                    }}
                  />
                )}

                {chartViewMode === "area" ? (
                  <>
                    <Area
                      type="monotone"
                      dataKey="actualSales"
                      name="Actual Sales (Past)"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#actualSalesGradient)"
                      dot={{ r: 2, fill: "#3b82f6" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="predictedDemand"
                      name="Predicted Demand (Future)"
                      stroke="#f59e0b"
                      strokeWidth={2.5}
                      strokeDasharray="4 4"
                      fillOpacity={1}
                      fill="url(#predictedDemandGradient)"
                      dot={{ r: 3, fill: "#f59e0b" }}
                    />
                  </>
                ) : (
                  <>
                    <Bar
                      dataKey="actualSales"
                      name="Actual Sales (Past)"
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="predictedDemand"
                      name="Predicted Demand (Future)"
                      fill="#f59e0b"
                      radius={[4, 4, 0, 0]}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#94a3b8",
              }}
            >
              <BarChart3 size={36} style={{ marginBottom: "8px" }} />
              <div>No forecast or sales data available for this selection.</div>
            </div>
          )}
        </div>
      </div>

      {/* 6. Daily Forecast Breakdown & Prediction History Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(450px, 1fr))",
          gap: "24px",
        }}
      >
        {/* Left Column: Daily Horizon Breakdown Table */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "20px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
              Daily Forecast Breakdown ({forecastData?.horizon_days || 7} Days)
            </h3>
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              Total: <b>{forecastData?.total_predicted_demand || 0} units</b>
            </span>
          </div>

          <div style={{ maxHeight: "320px", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b", textAlign: "left" }}>
                  <th style={{ padding: "8px 6px" }}>Day</th>
                  <th style={{ padding: "8px 6px" }}>Target Date</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Predicted Demand</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Daily % Share</th>
                </tr>
              </thead>
              <tbody>
                {(forecastData?.daily_forecasts || []).map((day) => {
                  const share = forecastData.total_predicted_demand > 0
                    ? ((day.predictedQuantity / forecastData.total_predicted_demand) * 100).toFixed(1)
                    : 0;

                  return (
                    <tr key={day.day_index} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ padding: "9px 6px", fontWeight: "600", color: "#475569" }}>
                        Day {day.day_index}
                      </td>
                      <td style={{ padding: "9px 6px", color: "#1e293b" }}>{day.date}</td>
                      <td style={{ padding: "9px 6px", textAlign: "right", fontWeight: "700", color: "#4f46e5" }}>
                        {day.predictedQuantity} units
                      </td>
                      <td style={{ padding: "9px 6px", textAlign: "right", color: "#64748b" }}>
                        {share}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Historical Predictions Log */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "12px",
            padding: "20px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
              Recent Forecast Audit Log
            </h3>
            <span style={{ fontSize: "12px", color: "#64748b" }}>MongoDB History</span>
          </div>

          <div style={{ maxHeight: "320px", overflowY: "auto" }}>
            {historyRecords.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b", textAlign: "left" }}>
                    <th style={{ padding: "8px 6px" }}>Timestamp</th>
                    <th style={{ padding: "8px 6px" }}>Horizon</th>
                    <th style={{ padding: "8px 6px" }}>Model</th>
                    <th style={{ padding: "8px 6px", textAlign: "right" }}>Forecast Units</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRecords.map((rec) => (
                    <tr key={rec._id} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ padding: "9px 6px", color: "#64748b", fontSize: "12px" }}>
                        {new Date(rec.createdAt).toLocaleDateString()}{" "}
                        {new Date(rec.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "9px 6px", color: "#1e293b", fontWeight: "600" }}>
                        {rec.horizonDays} Days
                      </td>
                      <td style={{ padding: "9px 6px" }}>
                        <span
                          style={{
                            fontSize: "11.5px",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            backgroundColor:
                              rec.modelDetails?.modelType === "XGBoost" ? "#eef2ff" : "#fef3c7",
                            color:
                              rec.modelDetails?.modelType === "XGBoost" ? "#4338ca" : "#b45309",
                            fontWeight: "600",
                          }}
                        >
                          {rec.modelDetails?.modelType || "XGBoost"}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "9px 6px",
                          textAlign: "right",
                          fontWeight: "700",
                          color: "#0f172a",
                        }}
                      >
                        {rec.predictedDemand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div
                style={{
                  padding: "40px 0",
                  textAlign: "center",
                  color: "#94a3b8",
                  fontSize: "13px",
                }}
              >
                No previous forecast audit logs found.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DemandForecasting;


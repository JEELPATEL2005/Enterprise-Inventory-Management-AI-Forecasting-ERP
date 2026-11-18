import api from "./axios";

export const forecastApi = {
  // Service health
  getHealth: async () => {
    const res = await api.get("/api/forecast/health");
    return res.data;
  },

  // Generate demand forecast
  predictDemand: async ({ productId, warehouseId = null, horizonDays = 7 }) => {
    const res = await api.post("/api/forecast/predict", {
      productId,
      warehouseId: warehouseId || null,
      horizonDays: Number(horizonDays),
    });
    return res.data;
  },

  // Retrain models
  trainModels: async ({ productId = null, warehouseId = null, forceRetrain = false }) => {
    const res = await api.post("/api/forecast/train", {
      productId: productId || null,
      warehouseId: warehouseId || null,
      forceRetrain,
    });
    return res.data;
  },

  // Get metrics across models
  getMetrics: async () => {
    const res = await api.get("/api/forecast/metrics");
    return res.data;
  },

  // Get forecast history
  getHistory: async ({ productId = null, warehouseId = null, limit = 20 } = {}) => {
    const params = new URLSearchParams();
    if (productId) params.append("productId", productId);
    if (warehouseId) params.append("warehouseId", warehouseId);
    if (limit) params.append("limit", limit);

    const res = await api.get(`/api/forecast/history?${params.toString()}`);
    return res.data;
  },

  // Helper to fetch products for dropdown
  getProducts: async () => {
    const res = await api.get("/api/products");
    return res.data;
  },

  // Helper to fetch warehouses for dropdown
  getWarehouses: async () => {
    const res = await api.get("/api/warehouses");
    return res.data;
  },
};

export default forecastApi;


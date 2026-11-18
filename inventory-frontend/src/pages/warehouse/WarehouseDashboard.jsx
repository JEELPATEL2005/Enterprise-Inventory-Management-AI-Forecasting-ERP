import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Warehouse,
  Boxes,
  ArrowLeftRight,
  ClipboardCheck,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  MapPin,
  UserCheck,
  ShoppingCart,
} from "lucide-react";
import StatCard from "../../components/common/StatCard";
import Toast from "../../components/common/Toast";
import axiosInstance from "../../utils/axiosConfig";

export const WarehouseDashboard = () => {
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [individualData, setIndividualData] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const fetchBaseData = async () => {
    try {
      setLoading(true);
      const [whRes, trfRes, invRes] = await Promise.all([
        axiosInstance.get("/api/warehouses"),
        axiosInstance.get("/api/stock-transfers"),
        axiosInstance.get("/api/inventory"),
      ]);

      const whList = whRes.data?.data || whRes.data || [];
      const trfList = trfRes.data?.data || trfRes.data || [];
      const invList = invRes.data?.data || invRes.data || [];

      setWarehouses(Array.isArray(whList) ? whList : []);
      setTransfers(Array.isArray(trfList) ? trfList : []);
      setInventory(Array.isArray(invList) ? invList : []);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load warehouse metrics.",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchIndividualWarehouse = async (whId) => {
    try {
      setLoading(true);
      const res = await axiosInstance.get(`/api/dashboard/warehouse/${whId}`);
      setIndividualData(res.data);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load individual facility dashboard.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (selectedWarehouseId) {
      fetchIndividualWarehouse(selectedWarehouseId);
    } else {
      setIndividualData(null);
    }
  }, [selectedWarehouseId]);

  // Aggregate metrics across all warehouses
  const totalStockUnits = inventory.reduce((acc, i) => acc + (i.quantity || 0), 0);
  const pendingTransfers = transfers.filter((t) => ["REQUESTED", "APPROVED", "IN_TRANSIT"].includes(t.status)).length;
  const totalDamagedUnits = inventory.reduce((acc, i) => acc + (i.damagedStock || 0), 0);
  const totalReservedUnits = inventory.reduce((acc, i) => acc + (i.reservedStock || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header-row">
        <div className="page-header-title">
          <h1>Multi-Warehouse Management Hub</h1>
          <p>
            {selectedWarehouseId
              ? `Operational view for ${individualData?.warehouse?.name || "Selected Facility"}`
              : "Central operations network, multi-facility metrics, bay utilization, and inter-warehouse logistics"}
          </p>
        </div>
        <div className="header-actions">
          {/* Warehouse Selector */}
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-slate-300)",
              fontSize: "13px",
              background: "#fff",
              fontWeight: "600",
            }}
          >
            <option value="">🌐 All Facilities (Central Operations)</option>
            {warehouses.map((w) => (
              <option key={w._id} value={w._id}>
                📍 {w.warehouseName || w.name} ({w.primaryManager?.name ? `Mgr: ${w.primaryManager.name}` : "Unassigned"})
              </option>
            ))}
          </select>

          <button
            type="button"
            className="btn-secondary"
            onClick={selectedWarehouseId ? () => fetchIndividualWarehouse(selectedWarehouseId) : fetchBaseData}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
          <Link to="/warehouse/transfers" className="btn-secondary">
            <ArrowLeftRight size={15} />
            <span>Transfer Manifests</span>
          </Link>
          <Link to="/warehouse/list" className="btn-primary">
            <Warehouse size={15} />
            <span>Manage Facilities</span>
          </Link>
        </div>
      </div>

      {/* KPI Row: Either Individual Warehouse or Multi-Warehouse Aggregate */}
      {selectedWarehouseId && individualData ? (
        <div className="kpi-row">
          <StatCard
            title="Capacity Utilization"
            value={`${individualData.metrics?.capacityUtilization}%`}
            trend={`${individualData.metrics?.totalStock?.toLocaleString()} / ${individualData.warehouse?.capacity?.toLocaleString()} Bins`}
            trendPositive={individualData.metrics?.capacityUtilization < 85}
            icon={Warehouse}
            colorScheme="indigo"
          />
          <StatCard
            title="Available to Promise"
            value={individualData.metrics?.availableStock?.toLocaleString()}
            trend={`${individualData.metrics?.skuCount} Active Product SKUs`}
            trendPositive={true}
            icon={Boxes}
            colorScheme="emerald"
          />
          <StatCard
            title="Facility Stock Valuation"
            value={`$${Number(individualData.metrics?.totalValuation || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            trend={`Allocated: ${individualData.metrics?.reservedStock} units`}
            trendPositive={true}
            icon={TrendingUp}
            colorScheme="cyan"
          />
          <StatCard
            title="Low Stock / Damaged"
            value={individualData.metrics?.lowStockCount || 0}
            trend={`${individualData.metrics?.damagedStock || 0} quarantined damaged`}
            trendPositive={(individualData.metrics?.lowStockCount || 0) === 0}
            icon={AlertTriangle}
            colorScheme="rose"
          />
        </div>
      ) : (
        <div className="kpi-row">
          <StatCard
            title="Active Facilities"
            value={warehouses.length}
            trend={`${warehouses.filter((w) => w.status !== "INACTIVE").length} operational`}
            trendPositive={true}
            icon={Warehouse}
            colorScheme="indigo"
          />
          <StatCard
            title="Total Units in Storage"
            value={totalStockUnits.toLocaleString()}
            trend={`${Math.max(0, totalStockUnits - totalReservedUnits).toLocaleString()} Available to Promise`}
            trendPositive={true}
            icon={Boxes}
            colorScheme="emerald"
          />
          <StatCard
            title="Transfers In Flight"
            value={pendingTransfers}
            trend={`${transfers.filter((t) => t.status === "COMPLETED").length} completed to date`}
            trendPositive={true}
            icon={ArrowLeftRight}
            colorScheme="amber"
          />
          <StatCard
            title="Quarantined Damaged"
            value={totalDamagedUnits}
            trend={totalDamagedUnits > 0 ? "Requires scrap sign-off" : "Clean inventory status"}
            trendPositive={totalDamagedUnits === 0}
            icon={AlertTriangle}
            colorScheme="rose"
          />
        </div>
      )}

      {/* Central Comparative Matrix or Individual Detail */}
      {selectedWarehouseId && individualData ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Facility Low Stock SKUs */}
          <div className="card-panel">
            <div className="card-panel-header">
              <div>
                <div className="card-panel-title">Low Stock Alerts in this Facility</div>
                <div className="card-panel-subtitle">Items at or below local reorder threshold</div>
              </div>
              <span className="badge badge-warning">
                {individualData.lowStockProducts?.length || 0} Alert SKUs
              </span>
            </div>

            {(!individualData.lowStockProducts || individualData.lowStockProducts.length === 0) ? (
              <div className="empty-state" style={{ padding: "24px" }}>
                <p>All product SKUs in this warehouse meet safe inventory thresholds.</p>
              </div>
            ) : (
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Available</th>
                    <th>Reorder Level</th>
                  </tr>
                </thead>
                <tbody>
                  {individualData.lowStockProducts.map((p, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: "600" }}>{p.product}</td>
                      <td><code>{p.sku}</code></td>
                      <td style={{ color: "var(--color-rose-600)", fontWeight: "700" }}>{p.availableStock}</td>
                      <td>{p.reorderPoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Pending Facility Operations */}
          <div className="card-panel">
            <div className="card-panel-header">
              <div>
                <div className="card-panel-title">Facility Dock & Fulfillment Queue</div>
                <div className="card-panel-subtitle">Inbound shipments, transfers and outbound orders</div>
              </div>
            </div>

            <table className="erp-table">
              <tbody>
                <tr>
                  <td style={{ fontWeight: "600" }}>Pending Inbound PO Deliveries:</td>
                  <td style={{ textAlign: "right", fontWeight: "700", color: "var(--color-primary-700)" }}>
                    {individualData.operations?.pendingIncomingPOs || 0} Orders
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>Active Inter-Warehouse Transfers:</td>
                  <td style={{ textAlign: "right", fontWeight: "700", color: "var(--color-amber-600)" }}>
                    {individualData.operations?.activeTransfers || 0} Shipments
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: "600" }}>Pending Sales Order Dispatches:</td>
                  <td style={{ textAlign: "right", fontWeight: "700", color: "var(--color-emerald-600)" }}>
                    {individualData.operations?.pendingSalesDispatches || 0} Dispatches
                  </td>
                </tr>
              </tbody>
            </table>

            <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <Link to="/warehouse/receiving" className="btn-secondary" style={{ flex: 1, minWidth: "120px", justifyContent: "center" }}>
                Goods Receiving (GRN)
              </Link>
              <Link to="/warehouse/transfers" className="btn-secondary" style={{ flex: 1, minWidth: "120px", justifyContent: "center" }}>
                Stock Transfers
              </Link>
              <Link to="/warehouse/requests" className="btn-primary" style={{ flex: 1, minWidth: "140px", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <ShoppingCart size={14} /> Purchase Request
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="card-panel">
          <div className="card-panel-header">
            <div>
              <div className="card-panel-title">Facility Storage & Space Utilization Matrix</div>
              <div className="card-panel-subtitle">Comparative live capacity status across regional warehouse network</div>
            </div>
            <Link to="/warehouse/list" style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--color-primary-600)" }}>
              Facility Directory &rarr;
            </Link>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: "32px", color: "var(--color-slate-500)" }}>
              Loading comparative facility matrix...
            </div>
          ) : warehouses.length === 0 ? (
            <div className="empty-state">
              <Warehouse size={44} style={{ margin: "0 auto", opacity: 0.3 }} />
              <h3>No warehouse facilities configured</h3>
              <p>Add your first facility in the Warehouses directory.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="erp-table">
                <thead>
                  <tr>
                    <th>Facility Name</th>
                    <th>Location</th>
                    <th>Responsible Manager</th>
                    <th>Capacity Utilization</th>
                    <th>Units Stored</th>
                    <th>Operational Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((wh) => {
                    const facilityItems = inventory.filter(
                      (i) => String(i.warehouse?._id || i.warehouse) === String(wh._id)
                    );
                    const facilityUnits = facilityItems.reduce((acc, i) => acc + (i.quantity || 0), 0);
                    const capacity = wh.capacity || 10000;
                    const util = capacity > 0 ? Number(((facilityUnits / capacity) * 100).toFixed(1)) : 0;
                    let barColor = "var(--color-emerald-500)";
                    if (util > 75) barColor = "var(--color-amber-500)";
                    if (util > 90) barColor = "var(--color-rose-500)";

                    return (
                      <tr key={wh._id}>
                        <td style={{ fontWeight: "700", color: "var(--color-slate-900)" }}>
                          {wh.warehouseName || wh.name}
                        </td>
                        <td>
                          <div style={{ fontSize: "12px", color: "var(--color-slate-500)", display: "flex", alignItems: "center", gap: "4px" }}>
                            <MapPin size={12} /> {wh.location || "Central"}
                          </div>
                        </td>
                        <td>
                          {wh.primaryManager ? (
                            <div>
                              <div style={{ fontWeight: "600", color: "var(--color-primary-700)" }}>
                                {wh.primaryManager.name}
                              </div>
                              <div style={{ fontSize: "11px", color: "var(--color-slate-400)" }}>
                                {wh.primaryManager.email}
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontSize: "12px", color: "var(--color-slate-400)", fontStyle: "italic" }}>
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ minWidth: "140px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginBottom: "4px" }}>
                              <span>{util}%</span>
                              <span style={{ color: "var(--color-slate-400)" }}>{capacity.toLocaleString()} Bins</span>
                            </div>
                            <div style={{ width: "100%", height: "6px", background: "var(--color-slate-100)", borderRadius: "3px", overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(100, util)}%`, height: "100%", background: barColor }} />
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong>{facilityUnits.toLocaleString()}</strong> units ({facilityItems.length} SKUs)
                        </td>
                        <td>
                          <span className={`badge ${wh.status !== "INACTIVE" ? "badge-active" : "badge-inactive"}`}>
                            {wh.status || "ACTIVE"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: "11.5px", padding: "4px 8px" }}
                            onClick={() => setSelectedWarehouseId(wh._id)}
                          >
                            View Facility
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WarehouseDashboard;

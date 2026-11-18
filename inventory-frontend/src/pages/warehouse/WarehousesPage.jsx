import React, { useState, useEffect } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  MapPin,
  UserCheck,
  BarChart2,
  CheckCircle,
  XCircle,
  Boxes,
} from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import api from "../../api/axios";

export const WarehousesPage = () => {
  const [warehouses, setWarehouses] = useState([]);
  const [managers, setManagers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [isPerfModalOpen, setIsPerfModalOpen] = useState(false);

  // Quick provision manager form
  const [showNewManagerForm, setShowNewManagerForm] = useState(false);
  const [newManagerData, setNewManagerData] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
  });
  const [creatingManager, setCreatingManager] = useState(false);

  // Selected warehouse for operations
  const [selectedWarehouse, setSelectedWarehouse] = useState(null);
  const [selectedManagerId, setSelectedManagerId] = useState("");
  const [performanceData, setPerformanceData] = useState(null);
  const [perfLoading, setPerfLoading] = useState(false);

  const [formData, setFormData] = useState({
    warehouseName: "",
    location: "",
    capacity: 10000,
    primaryManager: "",
    status: "ACTIVE",
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [whRes, empRes, roleRes] = await Promise.all([
        api.get("/api/warehouses"),
        api.get("/api/employees"),
        api.get("/api/roles"),
      ]);

      setWarehouses(whRes.data?.data || []);
      setRoles(roleRes.data?.data || []);

      // Filter employees who belong to Warehouse department or have Warehouse role
      const allEmps = empRes.data?.data || [];
      const whManagers = allEmps.filter(
        (emp) =>
          emp.department === "WAREHOUSE" ||
          emp.role?.roleName === "WAREHOUSE_MANAGER" ||
          emp.role === "WAREHOUSE_MANAGER"
      );
      setManagers(whManagers.length > 0 ? whManagers : allEmps);
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to load facilities.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formData.warehouseName || !formData.location) return;
    setSubmitting(true);
    try {
      await api.post("/api/warehouses", {
        warehouseName: formData.warehouseName.trim(),
        location: formData.location.trim(),
        capacity: Number(formData.capacity) || 10000,
        primaryManager: formData.primaryManager || undefined,
        status: formData.status || "ACTIVE",
      });
      setToast({ message: "Storage facility commissioned successfully.", type: "success" });
      setIsCreateModalOpen(false);
      setFormData({
        warehouseName: "",
        location: "",
        capacity: 10000,
        primaryManager: "",
        status: "ACTIVE",
      });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to register warehouse.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openAssignModal = (wh) => {
    setSelectedWarehouse(wh);
    setSelectedManagerId(wh.primaryManager?._id || wh.primaryManager || "");
    setIsAssignModalOpen(true);
  };

  const handleAssignManager = async (e) => {
    e.preventDefault();
    if (!selectedWarehouse) return;
    setSubmitting(true);
    try {
      await api.put(`/api/warehouses/${selectedWarehouse._id}/assign-manager`, {
        managerId: selectedManagerId || null,
      });
      setToast({
        message: "Warehouse manager assignment updated successfully.",
        type: "success",
      });
      setIsAssignModalOpen(false);
      setShowNewManagerForm(false);
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to update manager assignment.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAndAssignManager = async (e) => {
    e.preventDefault();
    if (!newManagerData.name || !newManagerData.email || !newManagerData.password) {
      setToast({ message: "Name, email, and password are required.", type: "error" });
      return;
    }
    setCreatingManager(true);
    try {
      const whRole = roles.find((r) => r.roleName === "WAREHOUSE_MANAGER");
      const empRes = await api.post("/api/employees", {
        name: newManagerData.name.trim(),
        email: newManagerData.email.trim(),
        phone: newManagerData.phone.trim(),
        password: newManagerData.password,
        department: "WAREHOUSE",
        role: whRole?._id,
        assignedWarehouses: selectedWarehouse ? [selectedWarehouse._id] : [],
      });

      const newEmp = empRes.data?.data;
      if (selectedWarehouse && newEmp) {
        await api.put(`/api/warehouses/${selectedWarehouse._id}/assign-manager`, {
          managerId: newEmp._id,
        });
      }

      setToast({
        message: `Warehouse Manager '${newManagerData.name}' created and assigned to ${selectedWarehouse?.warehouseName}!`,
        type: "success",
      });

      setShowNewManagerForm(false);
      setNewManagerData({ name: "", email: "", phone: "", password: "" });
      setIsAssignModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to provision manager.",
        type: "error",
      });
    } finally {
      setCreatingManager(false);
    }
  };

  const openPerformanceModal = async (wh) => {
    setSelectedWarehouse(wh);
    setIsPerfModalOpen(true);
    setPerfLoading(true);
    try {
      const res = await api.get(`/api/warehouses/${wh._id}/performance`);
      setPerformanceData(res.data);
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to load warehouse performance.",
        type: "error",
      });
    } finally {
      setPerfLoading(false);
    }
  };

  const handleToggleStatus = async (wh) => {
    const newStatus = wh.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.put(`/api/warehouses/${wh._id}`, { status: newStatus });
      setToast({
        message: `Warehouse ${wh.warehouseName} is now ${newStatus}.`,
        type: "success",
      });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to update warehouse status.",
        type: "error",
      });
    }
  };

  const handleDelete = async (wh) => {
    if (wh.currentStock > 0) {
      alert(
        `Cannot decommission '${wh.warehouseName}' because it currently holds ${wh.currentStock} units in inventory. Please transfer or adjust all stock to 0 first, or deactivate the warehouse.`
      );
      return;
    }
    if (!window.confirm(`Are you sure you want to permanently remove facility '${wh.warehouseName}'?`)) {
      return;
    }
    try {
      await api.delete(`/api/warehouses/${wh._id}`);
      setToast({ message: "Warehouse decommissioned and removed.", type: "success" });
      setWarehouses((prev) => prev.filter((w) => w._id !== wh._id));
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to delete warehouse.",
        type: "error",
      });
    }
  };

  const columns = [
    {
      header: "Warehouse Facility",
      accessor: "warehouseName",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: "700", color: "var(--color-slate-900)" }}>{val}</div>
          <div style={{ fontSize: "12px", color: "var(--color-slate-500)", display: "flex", alignItems: "center", gap: "4px" }}>
            <MapPin size={12} /> {row.location}
          </div>
        </div>
      ),
    },
    {
      header: "Responsible Manager",
      accessor: "primaryManager",
      render: (mgr, row) => {
        if (!mgr) {
          return (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "11.5px", padding: "4px 8px" }}
              onClick={() => openAssignModal(row)}
            >
              <UserCheck size={13} />
              <span>Assign Manager</span>
            </button>
          );
        }
        return (
          <div
            onClick={() => openAssignModal(row)}
            style={{ cursor: "pointer" }}
            title="Click to reassign manager"
          >
            <div style={{ fontWeight: "600", color: "var(--color-primary-700)" }}>{mgr.name}</div>
            <div style={{ fontSize: "11px", color: "var(--color-slate-400)" }}>{mgr.email}</div>
          </div>
        );
      },
    },
    {
      header: "Capacity & Utilization",
      accessor: "capacity",
      render: (cap, row) => {
        const currentStock = row.currentStock || 0;
        const util = row.capacityUtilization || 0;
        let barColor = "var(--color-emerald-500)";
        if (util > 75) barColor = "var(--color-amber-500)";
        if (util > 90) barColor = "var(--color-rose-500)";

        return (
          <div style={{ minWidth: "160px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
              <span style={{ fontWeight: "600" }}>{currentStock.toLocaleString()} / {Number(cap || 0).toLocaleString()} Bins</span>
              <span style={{ fontWeight: "700", color: barColor }}>{util}%</span>
            </div>
            <div style={{ width: "100%", height: "6px", background: "var(--color-slate-100)", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, util)}%`, height: "100%", background: barColor }} />
            </div>
          </div>
        );
      },
    },
    {
      header: "Status",
      accessor: "status",
      render: (val, row) => (
        <button
          type="button"
          onClick={() => handleToggleStatus(row)}
          className={`badge ${val === "ACTIVE" ? "badge-active" : "badge-inactive"}`}
          style={{ cursor: "pointer", border: "none" }}
          title="Click to toggle status"
        >
          {val || "ACTIVE"}
        </button>
      ),
    },
    {
      header: "Analytics & Actions",
      accessor: "_id",
      render: (id, row) => (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className="action-icon-btn"
            onClick={() => openPerformanceModal(row)}
            title="View Facility Performance Analytics"
          >
            <BarChart2 size={16} />
          </button>
          <button
            type="button"
            className="action-icon-btn"
            onClick={() => openAssignModal(row)}
            title="Assign / Reassign Manager"
          >
            <UserCheck size={16} />
          </button>
          <button
            type="button"
            className="action-icon-btn danger"
            onClick={() => handleDelete(row)}
            title="Decommission Warehouse"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-header-row">
        <div className="page-header-title">
          <h1>Storage Facilities & Multi-Warehouse Management</h1>
          <p>Distribution centers, responsible manager assignments, bay capacity utilization, and facility analytics</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
          <button type="button" className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
            <Plus size={16} />
            <span>Add New Warehouse</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--color-slate-500)" }}>
          Loading storage facilities and manager assignments...
        </div>
      ) : warehouses.length === 0 ? (
        <div className="empty-state card-panel">
          <h3>No Warehouses Registered</h3>
          <p>Commission your first distribution warehouse facility to manage inventory.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={warehouses}
          searchKey="warehouseName"
          searchPlaceholder="Filter facilities by name or location..."
        />
      )}

      {/* Commission Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Commission New Storage Facility"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setIsCreateModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="wh-form" className="btn-primary" disabled={submitting}>
              {submitting ? "Registering..." : "Register Warehouse"}
            </button>
          </>
        }
      >
        <form id="wh-form" onSubmit={handleCreate}>
          <div className="form-field">
            <label>Facility Name *</label>
            <input
              type="text"
              required
              value={formData.warehouseName}
              onChange={(e) => setFormData({ ...formData, warehouseName: e.target.value })}
              placeholder="e.g. Midwest Logistics Hub"
            />
          </div>

          <div className="form-field">
            <label>Physical Address / Location *</label>
            <input
              type="text"
              required
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="e.g. 100 Logistics Pkwy, Chicago, IL"
            />
          </div>

          <div className="form-field">
            <label>Total Bin Storage Capacity (Units) *</label>
            <input
              type="number"
              min="1"
              required
              value={formData.capacity}
              onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
            />
          </div>

          <div className="form-field">
            <label>Designated Primary Warehouse Manager</label>
            <select
              value={formData.primaryManager}
              onChange={(e) => setFormData({ ...formData, primaryManager: e.target.value })}
            >
              <option value="">-- Select Warehouse Manager (Optional) --</option>
              {managers.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>Initial Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
        </form>
      </Modal>

      {/* Assign / Reassign Manager Modal */}
      <Modal
        isOpen={isAssignModalOpen}
        onClose={() => {
          setIsAssignModalOpen(false);
          setShowNewManagerForm(false);
        }}
        title={`Assign Facility Manager: ${selectedWarehouse?.warehouseName || ""}`}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setIsAssignModalOpen(false);
                setShowNewManagerForm(false);
              }}
            >
              Cancel
            </button>
            {!showNewManagerForm && (
              <button type="submit" form="assign-form" className="btn-primary" disabled={submitting}>
                {submitting ? "Updating..." : "Save Assignment"}
              </button>
            )}
          </>
        }
      >
        <form id="assign-form" onSubmit={handleAssignManager}>
          <p style={{ fontSize: "13px", color: "var(--color-slate-600)", marginBottom: "16px" }}>
            Designate the primary responsible Warehouse Manager for <strong>{selectedWarehouse?.warehouseName}</strong>.
            This user will automatically receive authorization to manage stock intake, dispatches, cycle counts, and PRs for this warehouse.
          </p>

          <div className="form-field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label style={{ margin: 0, fontWeight: "600", fontSize: "13px" }}>Select Warehouse Manager</label>
              <button
                type="button"
                onClick={() => setShowNewManagerForm(!showNewManagerForm)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#2563eb",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <UserCheck size={14} />
                <span>{showNewManagerForm ? "← Select Existing Manager" : "+ Provision New Manager"}</span>
              </button>
            </div>

            {!showNewManagerForm ? (
              <select
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
              >
                <option value="">-- No Manager Assigned (Unassigned) --</option>
                {managers.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.name} ({m.email}) - {m.department}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  padding: "14px",
                  background: "#f8fafc",
                  border: "1px solid #bfdbfe",
                  borderRadius: "8px",
                  marginTop: "8px",
                }}
              >
                <div style={{ fontWeight: "700", fontSize: "13px", color: "#1e293b", marginBottom: "10px" }}>
                  Quick Provision New Warehouse Manager
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#475569" }}>Full Name *</label>
                    <input
                      type="text"
                      required
                      value={newManagerData.name}
                      onChange={(e) => setNewManagerData((p) => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Alex Mercer"
                      style={{ fontSize: "12px", padding: "6px 8px" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#475569" }}>Email *</label>
                    <input
                      type="email"
                      required
                      value={newManagerData.email}
                      onChange={(e) => setNewManagerData((p) => ({ ...p, email: e.target.value }))}
                      placeholder="alex.warehouse@erp.local"
                      style={{ fontSize: "12px", padding: "6px 8px" }}
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#475569" }}>Contact Phone</label>
                    <input
                      type="text"
                      value={newManagerData.phone}
                      onChange={(e) => setNewManagerData((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="+1 (555) 234-5678"
                      style={{ fontSize: "12px", padding: "6px 8px" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: "600", color: "#475569" }}>Initial Password *</label>
                    <input
                      type="password"
                      required
                      value={newManagerData.password}
                      onChange={(e) => setNewManagerData((p) => ({ ...p, password: e.target.value }))}
                      placeholder="Min 8 characters"
                      style={{ fontSize: "12px", padding: "6px 8px" }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowNewManagerForm(false)}
                    style={{ fontSize: "12px", padding: "6px 12px" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleCreateAndAssignManager}
                    disabled={creatingManager}
                    style={{ fontSize: "12px", padding: "6px 12px" }}
                  >
                    {creatingManager ? "Creating..." : "Create & Assign Manager"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </Modal>

      {/* Performance & Analytics Modal */}
      <Modal
        isOpen={isPerfModalOpen}
        onClose={() => setIsPerfModalOpen(false)}
        title={`Facility Performance: ${selectedWarehouse?.warehouseName || ""}`}
        footer={
          <button type="button" className="btn-secondary" onClick={() => setIsPerfModalOpen(false)}>
            Close
          </button>
        }
      >
        {perfLoading || !performanceData ? (
          <div style={{ padding: "30px", textAlign: "center" }}>Calculating warehouse metrics...</div>
        ) : (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
              <div className="card-panel" style={{ padding: "16px", margin: 0 }}>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Capacity Utilization</div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--color-primary-700)" }}>
                  {performanceData.metrics?.capacityUtilization}%
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-400)" }}>
                  {performanceData.metrics?.totalQuantity} / {performanceData.warehouse?.capacity} Bins
                </div>
              </div>

              <div className="card-panel" style={{ padding: "16px", margin: 0 }}>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Total Stock Valuation</div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--color-emerald-700)" }}>
                  ${Number(performanceData.metrics?.totalValuation || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-400)" }}>
                  {performanceData.metrics?.skuCount} Active Product SKUs
                </div>
              </div>
            </div>

            <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse", marginBottom: "16px" }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                  <td style={{ padding: "8px 0", color: "var(--color-slate-500)" }}>Available to Promise:</td>
                  <td style={{ padding: "8px 0", fontWeight: "700", textAlign: "right", color: "var(--color-emerald-600)" }}>
                    {performanceData.metrics?.availableStock} Units
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                  <td style={{ padding: "8px 0", color: "var(--color-slate-500)" }}>Allocated / Reserved:</td>
                  <td style={{ padding: "8px 0", fontWeight: "700", textAlign: "right", color: "var(--color-amber-600)" }}>
                    {performanceData.metrics?.reservedStock} Units
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                  <td style={{ padding: "8px 0", color: "var(--color-slate-500)" }}>Quarantined Damaged:</td>
                  <td style={{ padding: "8px 0", fontWeight: "700", textAlign: "right", color: "var(--color-rose-600)" }}>
                    {performanceData.metrics?.damagedStock} Units
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                  <td style={{ padding: "8px 0", color: "var(--color-slate-500)" }}>Low Stock SKUs:</td>
                  <td style={{ padding: "8px 0", fontWeight: "700", textAlign: "right", color: "var(--color-rose-600)" }}>
                    {performanceData.metrics?.lowStockSkuCount} SKUs
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                  <td style={{ padding: "8px 0", color: "var(--color-slate-500)" }}>Pending Inbound PO Receipts:</td>
                  <td style={{ padding: "8px 0", fontWeight: "700", textAlign: "right" }}>
                    {performanceData.operations?.incomingDeliveriesPending}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                  <td style={{ padding: "8px 0", color: "var(--color-slate-500)" }}>Active Stock Transfers:</td>
                  <td style={{ padding: "8px 0", fontWeight: "700", textAlign: "right" }}>
                    {performanceData.operations?.activeStockTransfers}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 0", color: "var(--color-slate-500)" }}>Pending Sales Dispatches:</td>
                  <td style={{ padding: "8px 0", fontWeight: "700", textAlign: "right" }}>
                    {performanceData.operations?.pendingSalesDispatches}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WarehousesPage;

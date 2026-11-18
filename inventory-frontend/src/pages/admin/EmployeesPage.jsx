import React, { useState, useEffect } from "react";
import { UserPlus, Shield, Trash2, RefreshCw, MapPin, Building2, Warehouse } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import api from "../../api/axios";

export const EmployeesPage = () => {
  const [employees, setEmployees] = useState([]);
  const [roles, setRoles] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAssignWhModalOpen, setIsAssignWhModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeeWarehouses, setEmployeeWarehouses] = useState([]);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    department: "ADMIN",
    role: "",
    phone: "",
    password: "",
    assignedWarehouses: [],
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState(null);

  const fetchEmployeesAndRoles = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const [empRes, roleRes, whRes] = await Promise.all([
        api.get("/api/employees"),
        api.get("/api/roles"),
        api.get("/api/warehouses"),
      ]);
      setEmployees(empRes.data?.data || []);
      const roleData = roleRes.data?.data || [];
      setRoles(roleData);
      setWarehouses(whRes.data?.data || []);

      if (roleData.length > 0 && !formData.role) {
        setFormData((prev) => ({ ...prev, role: roleData[0]._id }));
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.message || "Failed to load workforce directory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployeesAndRoles();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRoleChange = (e) => {
    const roleId = e.target.value;
    const selectedRole = roles.find((r) => r._id === roleId);
    let newDept = formData.department;

    if (selectedRole) {
      const rName = selectedRole.roleName?.toUpperCase();
      if (rName === "WAREHOUSE_MANAGER" || rName === "CENTRAL_WAREHOUSE_OPERATIONS_MANAGER") {
        newDept = "WAREHOUSE";
      } else if (rName === "PURCHASE_MANAGER") {
        newDept = "PURCHASE";
      } else if (rName === "SALES_MANAGER") {
        newDept = "SALES";
      } else if (rName === "ADMIN" || rName === "SUPER_ADMIN") {
        newDept = "ADMIN";
      }
    }

    setFormData((prev) => ({
      ...prev,
      role: roleId,
      department: newDept,
    }));
  };

  const handleToggleWarehouseForNewEmployee = (whId) => {
    setFormData((prev) => {
      const current = prev.assignedWarehouses || [];
      const updated = current.includes(whId)
        ? current.filter((id) => id !== whId)
        : [...current, whId];
      return { ...prev, assignedWarehouses: updated };
    });
  };

  const handleCreateEmployee = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/employees", formData);
      setToast({ message: "Employee provisioned successfully!", type: "success" });
      setIsModalOpen(false);
      setFormData({
        name: "",
        email: "",
        department: "ADMIN",
        role: roles[0]?._id || "",
        phone: "",
        password: "",
        assignedWarehouses: [],
      });
      fetchEmployeesAndRoles();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to create employee.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openAssignFacilitiesModal = (emp) => {
    setSelectedEmployee(emp);
    const currentWhIds = (emp.assignedWarehouses || []).map((w) => w._id || w);
    setEmployeeWarehouses(currentWhIds);
    setIsAssignWhModalOpen(true);
  };

  const handleToggleWarehouseForExisting = (whId) => {
    setEmployeeWarehouses((prev) =>
      prev.includes(whId) ? prev.filter((id) => id !== whId) : [...prev, whId]
    );
  };

  const handleSaveFacilityAssignments = async (e) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    setSubmitting(true);
    try {
      await api.put(`/api/employees/${selectedEmployee._id}`, {
        assignedWarehouses: employeeWarehouses,
      });
      setToast({
        message: `Facility assignments for ${selectedEmployee.name} updated successfully!`,
        type: "success",
      });
      setIsAssignWhModalOpen(false);
      fetchEmployeesAndRoles();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to update warehouse assignments.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteEmployee = async (id) => {
    if (!window.confirm("Are you sure you want to deactivate this employee?")) return;
    try {
      await api.delete(`/api/employees/${id}`);
      setToast({ message: "Employee removed successfully.", type: "success" });
      setEmployees((prev) => prev.filter((emp) => emp._id !== id));
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to delete employee.",
        type: "error",
      });
    }
  };

  const selectedRoleObj = roles.find((r) => r._id === formData.role);
  const isWarehouseRole =
    formData.department === "WAREHOUSE" ||
    selectedRoleObj?.roleName?.toUpperCase() === "WAREHOUSE_MANAGER" ||
    selectedRoleObj?.roleName?.toUpperCase() === "CENTRAL_WAREHOUSE_OPERATIONS_MANAGER";

  const columns = [
    {
      header: "Employee Name",
      accessor: "name",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: "700", color: "var(--color-slate-900)" }}>{val}</div>
          <div style={{ fontSize: "12px", color: "var(--color-slate-400)" }}>{row.email}</div>
        </div>
      ),
    },
    {
      header: "Department",
      accessor: "department",
      render: (val) => (
        <span
          style={{
            fontSize: "12px",
            fontWeight: "600",
            color: "var(--color-slate-700)",
            background: "var(--color-slate-100)",
            padding: "3px 8px",
            borderRadius: "4px",
          }}
        >
          {val || "GENERAL"}
        </span>
      ),
    },
    {
      header: "Assigned Role",
      accessor: "role",
      render: (roleObj) => (
        <span className="badge badge-info">
          <Shield size={12} />
          <span>{roleObj?.roleName || "No Role"}</span>
        </span>
      ),
    },
    {
      header: "Assigned Facilities",
      accessor: "assignedWarehouses",
      render: (whList, row) => {
        const isWh =
          row.department === "WAREHOUSE" ||
          row.role?.roleName === "WAREHOUSE_MANAGER" ||
          row.role === "WAREHOUSE_MANAGER";

        if (!isWh) {
          return <span style={{ color: "var(--color-slate-400)", fontSize: "12px" }}>—</span>;
        }

        if (!whList || whList.length === 0) {
          return (
            <span
              style={{
                fontSize: "11px",
                fontWeight: "600",
                color: "#d97706",
                background: "#fef3c7",
                border: "1px solid #fde68a",
                padding: "2px 8px",
                borderRadius: "12px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              ⚠️ Unassigned
            </span>
          );
        }

        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {whList.map((wh) => (
              <span
                key={wh._id || wh}
                style={{
                  fontSize: "11px",
                  fontWeight: "600",
                  color: "#2563eb",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <MapPin size={11} />
                <span>{wh.warehouseName || wh.location || "Facility"}</span>
              </span>
            ))}
          </div>
        );
      },
    },
    {
      header: "Phone",
      accessor: "phone",
      render: (val) => <span style={{ color: "var(--color-slate-600)" }}>{val || "—"}</span>,
    },
    {
      header: "Status",
      accessor: "status",
      render: (val) => (
        <span className={`badge ${val === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
          {val || "ACTIVE"}
        </span>
      ),
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (id, row) => (
        <div style={{ display: "flex", gap: "6px" }}>
          {(row.department === "WAREHOUSE" ||
            row.role?.roleName === "WAREHOUSE_MANAGER" ||
            row.role === "WAREHOUSE_MANAGER") && (
            <button
              type="button"
              className="action-icon-btn primary"
              onClick={() => openAssignFacilitiesModal(row)}
              title="Assign Storage Facilities"
              style={{ color: "#2563eb" }}
            >
              <Building2 size={15} />
            </button>
          )}
          <button
            type="button"
            className="action-icon-btn danger"
            onClick={() => handleDeleteEmployee(id)}
            title="Deactivate employee"
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
          <h1>Employee Workforce Directory</h1>
          <p>Provision staff accounts, assign departmental roles, and configure facility access</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={fetchEmployeesAndRoles}
            disabled={loading}
            title="Refresh employees"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsModalOpen(true)}
          >
            <UserPlus size={16} />
            <span>Add New Employee</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="login-error" style={{ marginBottom: "16px" }}>
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--color-slate-500)" }}>
          Loading employee records...
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={employees}
          searchKey="name"
          searchPlaceholder="Filter by name, email, department..."
          filterKey="department"
          filterOptions={[
            { label: "Admin", value: "ADMIN" },
            { label: "Purchase", value: "PURCHASE" },
            { label: "Warehouse", value: "WAREHOUSE" },
            { label: "Inventory", value: "INVENTORY" },
            { label: "Sales", value: "SALES" },
            { label: "Delivery", value: "DELIVERY" },
          ]}
        />
      )}

      {/* Register Employee Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Provision New Employee Account"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="employee-form"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? "Registering..." : "Create Account"}
            </button>
          </>
        }
      >
        <form id="employee-form" onSubmit={handleCreateEmployee}>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Full Name *</label>
              <input
                type="text"
                name="name"
                required
                value={formData.name}
                onChange={handleInputChange}
                placeholder="e.g. Alex Mercer"
              />
            </div>
            <div className="form-field">
              <label>Corporate Email *</label>
              <input
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleInputChange}
                placeholder="alex.warehouse@erp.local"
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>Role Assignment *</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleRoleChange}
                required
              >
                {roles.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.roleName}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Department *</label>
              <select
                name="department"
                value={formData.department}
                onChange={handleInputChange}
              >
                <option value="ADMIN">ADMIN</option>
                <option value="PURCHASE">PURCHASE</option>
                <option value="WAREHOUSE">WAREHOUSE</option>
                <option value="INVENTORY">INVENTORY</option>
                <option value="SALES">SALES</option>
                <option value="DELIVERY">DELIVERY</option>
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>Contact Phone</label>
              <input
                type="text"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                placeholder="+1 (555) 234-5678"
              />
            </div>
            <div className="form-field">
              <label>Initial Password *</label>
              <input
                type="password"
                name="password"
                required
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Minimum 8 characters"
              />
            </div>
          </div>

          {/* Warehouse Facility Assignment (Shown for Warehouse Managers) */}
          {isWarehouseRole && (
            <div style={{ marginTop: "16px", padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                <Warehouse size={16} color="#2563eb" />
                <label style={{ margin: 0, fontWeight: "700", fontSize: "13px", color: "#1e293b" }}>
                  Assign Storage Facilities
                </label>
              </div>
              <p style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#64748b" }}>
                Select the warehouse(s) this manager is authorized to access for stock receiving, cycle counts, adjustments, and dispatches.
              </p>

              {warehouses.length === 0 ? (
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                  No facilities found. You can commission warehouses later.
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {warehouses.map((wh) => {
                    const checked = formData.assignedWarehouses?.includes(wh._id);
                    return (
                      <label
                        key={wh._id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          fontSize: "12px",
                          padding: "8px 10px",
                          background: checked ? "#eff6ff" : "white",
                          border: `1px solid ${checked ? "#bfdbfe" : "#cbd5e1"}`,
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleToggleWarehouseForNewEmployee(wh._id)}
                        />
                        <div>
                          <div style={{ fontWeight: checked ? "700" : "600", color: checked ? "#1d4ed8" : "#334155" }}>
                            {wh.warehouseName}
                          </div>
                          <div style={{ fontSize: "10px", color: "#64748b" }}>
                            {wh.location}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* Facility Assignment Modal for Existing Employees */}
      <Modal
        isOpen={isAssignWhModalOpen}
        onClose={() => setIsAssignWhModalOpen(false)}
        title={`Assign Storage Facilities: ${selectedEmployee?.name || ""}`}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsAssignWhModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="assign-facility-form"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Save Assignments"}
            </button>
          </>
        }
      >
        <form id="assign-facility-form" onSubmit={handleSaveFacilityAssignments}>
          <div style={{ marginBottom: "16px", padding: "10px", background: "#f1f5f9", borderRadius: "6px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
              {selectedEmployee?.name} ({selectedEmployee?.email})
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              Role: {selectedEmployee?.role?.roleName || selectedEmployee?.role} | Department: {selectedEmployee?.department}
            </div>
          </div>

          <p style={{ fontSize: "13px", color: "#475569", marginBottom: "12px" }}>
            Check the facilities this Warehouse Manager has authority to operate. The manager will only be permitted to create PRs, perform stock intake/adjustments, and dispatch sales orders for checked warehouses.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px", maxHeight: "250px", overflowY: "auto" }}>
            {warehouses.map((wh) => {
              const isChecked = employeeWarehouses.includes(wh._id);
              const isPrimary = String(wh.primaryManager?._id || wh.primaryManager) === String(selectedEmployee?._id);

              return (
                <label
                  key={wh._id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    background: isChecked ? "#eff6ff" : "white",
                    border: `1px solid ${isChecked ? "#3b82f6" : "#cbd5e1"}`,
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleWarehouseForExisting(wh._id)}
                    />
                    <div>
                      <div style={{ fontWeight: "700", fontSize: "13px", color: isChecked ? "#1d4ed8" : "#1e293b" }}>
                        {wh.warehouseName}
                      </div>
                      <div style={{ fontSize: "11px", color: "#64748b" }}>
                        Location: {wh.location} | Capacity: {wh.capacity} bins
                      </div>
                    </div>
                  </div>

                  {isPrimary && (
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "700",
                        color: "#059669",
                        background: "#d1fae5",
                        padding: "2px 8px",
                        borderRadius: "10px",
                      }}
                    >
                      Primary Manager
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default EmployeesPage;

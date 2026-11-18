import React, { useState, useEffect } from "react";
import { Plus, RefreshCw, UserCheck, Trash2, ShoppingBag, Phone, Mail, MapPin, History, Eye, Edit2 } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import axiosInstance from "../../utils/axiosConfig";

export const CustomersPage = () => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerHistory, setCustomerHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [formData, setFormData] = useState({
    customerName: "",
    phone: "",
    email: "",
    address: "",
    status: "ACTIVE",
  });

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const res = await axiosInstance.get("/api/customers");
      const list = res.data?.data || res.data || [];
      setCustomers(Array.isArray(list) ? list : []);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load customers.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (!formData.customerName.trim() || !formData.phone.trim()) {
      setToast({ type: "error", message: "Customer name and phone are required." });
      return;
    }

    try {
      setSubmitting(true);
      await axiosInstance.post("/api/customers", formData);
      setToast({ type: "success", message: "Customer created successfully." });
      setIsCreateModalOpen(false);
      setFormData({ customerName: "", phone: "", email: "", address: "", status: "ACTIVE" });
      fetchCustomers();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to create customer.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditCustomer = async (e) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    try {
      setSubmitting(true);
      await axiosInstance.put(`/api/customers/${selectedCustomer._id}`, formData);
      setToast({ type: "success", message: "Customer updated successfully." });
      setIsEditModalOpen(false);
      fetchCustomers();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to update customer.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (cust) => {
    setSelectedCustomer(cust);
    setFormData({
      customerName: cust.customerName || "",
      phone: cust.phone || "",
      email: cust.email || "",
      address: cust.address || "",
      status: cust.status || "ACTIVE",
    });
    setIsEditModalOpen(true);
  };

  const openHistoryModal = async (cust) => {
    setSelectedCustomer(cust);
    setIsHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const res = await axiosInstance.get(`/api/customers/${cust._id}/orders`);
      setCustomerHistory(res.data?.data || null);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load customer order history.",
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleStatus = async (cust) => {
    const nextStatus = cust.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await axiosInstance.put(`/api/customers/${cust._id}`, { status: nextStatus });
      setToast({
        type: "success",
        message: `Customer ${cust.customerName} marked as ${nextStatus}.`,
      });
      fetchCustomers();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to update customer status.",
      });
    }
  };

  const handleDelete = async (cust) => {
    if (!window.confirm(`Are you sure you want to delete customer "${cust.customerName}"?`)) return;
    try {
      const res = await axiosInstance.delete(`/api/customers/${cust._id}`);
      if (res.data?.deactivated) {
        setToast({
          type: "warning",
          message: "Customer has historical orders and was set to INACTIVE to preserve audit records.",
        });
      } else {
        setToast({ type: "success", message: "Customer deleted successfully." });
      }
      fetchCustomers();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to delete customer.",
      });
    }
  };

  const columns = [
    {
      header: "Customer Name",
      accessor: "customerName",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: "700", color: "var(--color-slate-900)" }}>{val}</div>
          <div style={{ fontSize: "12px", color: "var(--color-slate-400)", display: "flex", alignItems: "center", gap: "4px" }}>
            <MapPin size={11} /> {row.address || "No address on file"}
          </div>
        </div>
      ),
    },
    {
      header: "Contact Phone",
      accessor: "phone",
      render: (val) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: "600" }}>
          <Phone size={13} style={{ color: "var(--color-slate-400)" }} /> {val}
        </span>
      ),
    },
    {
      header: "Email Address",
      accessor: "email",
      render: (val) => (
        <span style={{ color: val ? "var(--color-primary-700)" : "var(--color-slate-400)" }}>
          {val || "—"}
        </span>
      ),
    },
    {
      header: "Status",
      accessor: "status",
      render: (val, row) => (
        <button
          type="button"
          onClick={() => handleToggleStatus(row)}
          title={`Click to set ${val === "ACTIVE" ? "INACTIVE" : "ACTIVE"}`}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          <span className={`badge ${val === "ACTIVE" ? "badge-active" : "badge-inactive"}`}>
            {val || "ACTIVE"}
          </span>
        </button>
      ),
    },
    {
      header: "Registered Date",
      accessor: "createdAt",
      render: (val) => (
        <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>
          {val ? new Date(val).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (id, row) => (
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            className="action-icon-btn"
            onClick={() => openHistoryModal(row)}
            title="View Order History"
          >
            <History size={15} />
          </button>
          <button
            type="button"
            className="action-icon-btn"
            onClick={() => openEditModal(row)}
            title="Edit Customer"
          >
            <Edit2 size={15} />
          </button>
          <button
            type="button"
            className="action-icon-btn danger"
            onClick={() => handleDelete(row)}
            title="Delete Customer"
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
          <h1>Customer Management</h1>
          <p>Internal client registry, commercial contact profiles, duplicate protection, and transaction histories</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={fetchCustomers}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setFormData({ customerName: "", phone: "", email: "", address: "", status: "ACTIVE" });
              setIsCreateModalOpen(true);
            }}
          >
            <Plus size={16} />
            <span>New Customer</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--color-slate-500)" }}>
          Loading customer directory...
        </div>
      ) : customers.length === 0 ? (
        <div className="empty-state">
          <UserCheck size={48} style={{ margin: "0 auto", opacity: 0.3 }} />
          <h3>No customers registered</h3>
          <p>Register customers to create sales orders, invoices, and track buying trends.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={customers}
          searchPlaceholder="Search customer name, phone, or email..."
        />
      )}

      {/* Create Customer Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Register New Customer"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreateCustomer}
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Create Customer"}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateCustomer} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-field">
            <label>Customer / Business Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Acme Logistics Corp"
              value={formData.customerName}
              onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
            />
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>Phone Number (Unique) *</label>
              <input
                type="text"
                required
                placeholder="e.g. +1 555-0192"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="e.g. billing@acme.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>

          <div className="form-field">
            <label>Billing & Delivery Address</label>
            <textarea
              rows="2"
              placeholder="Full physical street address..."
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>
        </form>
      </Modal>

      {/* Edit Customer Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Customer Profile"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsEditModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleEditCustomer}
              disabled={submitting}
            >
              {submitting ? "Updating..." : "Save Changes"}
            </button>
          </>
        }
      >
        <form onSubmit={handleEditCustomer} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-field">
            <label>Customer Name *</label>
            <input
              type="text"
              required
              value={formData.customerName}
              onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
            />
          </div>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Phone Number *</label>
              <input
                type="text"
                required
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
          </div>
          <div className="form-field">
            <label>Address</label>
            <textarea
              rows="2"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>
          <div className="form-field">
            <label>Account Status</label>
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

      {/* Customer Order History Modal */}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title={`Transaction History: ${selectedCustomer?.customerName || "Customer"}`}
        footer={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsHistoryModalOpen(false)}
          >
            Close
          </button>
        }
      >
        {historyLoading ? (
          <div style={{ textAlign: "center", padding: "30px", color: "var(--color-slate-500)" }}>
            Loading customer transaction ledger...
          </div>
        ) : !customerHistory ? (
          <p>No history available.</p>
        ) : (
          <div>
            <div className="dashboard-grid-4" style={{ marginBottom: "16px" }}>
              <div className="stat-card" style={{ padding: "12px" }}>
                <span className="stat-card-title">Total Orders</span>
                <div className="stat-value" style={{ fontSize: "18px" }}>
                  {customerHistory.metrics?.totalOrders || 0}
                </div>
              </div>
              <div className="stat-card" style={{ padding: "12px" }}>
                <span className="stat-card-title">Total Spent</span>
                <div className="stat-value" style={{ fontSize: "18px", color: "var(--color-emerald-700)" }}>
                  ${Number(customerHistory.metrics?.totalSpent || 0).toLocaleString()}
                </div>
              </div>
              <div className="stat-card" style={{ padding: "12px" }}>
                <span className="stat-card-title">Invoices Issued</span>
                <div className="stat-value" style={{ fontSize: "18px" }}>
                  {customerHistory.metrics?.totalInvoices || 0}
                </div>
              </div>
            </div>

            <h4 style={{ margin: "16px 0 8px 0" }}>Sales Orders</h4>
            {customerHistory.orders?.length === 0 ? (
              <p style={{ color: "var(--color-slate-500)", fontSize: "13px" }}>No orders placed yet.</p>
            ) : (
              <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--color-slate-200)", borderRadius: "6px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead style={{ background: "var(--color-slate-50)" }}>
                    <tr>
                      <th style={{ padding: "6px 10px", textAlign: "left" }}>Order #</th>
                      <th style={{ padding: "6px 10px", textAlign: "left" }}>Date</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Total</th>
                      <th style={{ padding: "6px 10px", textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerHistory.orders.map((so) => (
                      <tr key={so._id} style={{ borderTop: "1px solid var(--color-slate-100)" }}>
                        <td style={{ padding: "6px 10px", fontWeight: "600" }}>{so.salesOrderNumber}</td>
                        <td style={{ padding: "6px 10px" }}>{new Date(so.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: "600" }}>
                          ${Number(so.totalAmount || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          <span className={`badge ${so.status === "FULFILLED" ? "badge-active" : "badge-pending"}`}>
                            {so.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CustomersPage;


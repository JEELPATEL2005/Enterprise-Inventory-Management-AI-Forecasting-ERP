import React, { useState, useEffect } from "react";
import { Plus, RefreshCw, Trash2, Star, History, Edit2, Phone, Mail, Building2, User, FileText } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import api from "../../api/axios";

export const VendorsPage = () => {
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [vendorHistory, setVendorHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const [formData, setFormData] = useState({
    vendorName: "",
    contactPerson: "",
    gstNumber: "",
    phone: "",
    email: "",
    address: "",
    rating: 5,
  });

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/vendors");
      setVendors(res.data?.data || []);
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to load vendors.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVendors();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = formData.vendorName.trim();
    const phone = formData.phone.trim();
    const email = formData.email.trim();

    if (!name || name.length < 2) {
      setToast({ message: "Vendor entity name must be at least 2 characters.", type: "error" });
      return;
    }

    if (!phone) {
      setToast({ message: "Contact phone/mobile number is required.", type: "error" });
      return;
    }

    const cleanPhone = phone.replace(/[\s\-()]/g, "");
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      setToast({
        message: "Mobile number must contain between 10 and 15 digits (e.g. 9876543210 or +15551234567).",
        type: "error",
      });
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setToast({ message: "A valid corporate email is required for vendor communication.", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/vendors", {
        vendorName: name,
        contactPerson: formData.contactPerson.trim(),
        gstNumber: formData.gstNumber.trim().toUpperCase(),
        phone: cleanPhone,
        email: email.toLowerCase(),
        address: formData.address.trim() || undefined,
        rating: Number(formData.rating) || 5,
      });
      setToast({ message: "Vendor registered successfully.", type: "success" });
      setIsModalOpen(false);
      setFormData({ vendorName: "", contactPerson: "", gstNumber: "", phone: "", email: "", address: "", rating: 5 });
      fetchVendors();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to create vendor.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (vendor) => {
    const nextStatus = vendor.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.put(`/api/vendors/${vendor._id}`, { status: nextStatus });
      setToast({
        message: `Vendor "${vendor.vendorName}" status changed to ${nextStatus}.`,
        type: "success",
      });
      setVendors((prev) =>
        prev.map((v) => (v._id === vendor._id ? { ...v, status: nextStatus } : v))
      );
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to update vendor status.",
        type: "error",
      });
    }
  };

  const openHistory = async (vendor) => {
    setSelectedVendor(vendor);
    setIsHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const res = await api.get(`/api/vendors/${vendor._id}/orders`);
      setVendorHistory(res.data?.data || null);
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to load vendor PO history.",
        type: "error",
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDelete = async (targetId, fallbackRow) => {
    const id = typeof targetId === "string" ? targetId : fallbackRow?._id;
    if (!id) return;

    if (!window.confirm("Are you sure you want to delete this vendor?")) return;

    try {
      const res = await api.delete(`/api/vendors/${id}`);
      if (res.data?.deactivated) {
        setToast({
          message: "Vendor has historical transactions and was set to INACTIVE to preserve audit records.",
          type: "warning",
        });
        setVendors((prev) =>
          prev.map((v) => (v._id === id ? { ...v, status: "INACTIVE" } : v))
        );
      } else {
        setToast({ message: "Vendor permanently deleted.", type: "success" });
        setVendors((prev) => prev.filter((v) => v._id !== id));
      }
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to delete vendor.",
        type: "error",
      });
    }
  };

  const columns = [
    {
      header: "Vendor Entity",
      accessor: "vendorName",
      render: (val, row) => (
        <div>
          <div style={{ fontWeight: "700", color: "var(--color-slate-900)" }}>{val}</div>
          <div style={{ fontSize: "12px", color: "var(--color-slate-500)", display: "flex", gap: "10px" }}>
            {row.contactPerson && <span>Contact: {row.contactPerson}</span>}
            {row.gstNumber && <span>GST: <strong>{row.gstNumber}</strong></span>}
          </div>
        </div>
      ),
    },
    {
      header: "Corporate Email",
      accessor: "email",
      render: (val) => (
        <span style={{ color: "var(--color-primary-700)", fontWeight: "500" }}>{val || "—"}</span>
      ),
    },
    { header: "Phone", accessor: "phone" },
    {
      header: "Quality Score",
      accessor: "rating",
      render: (val) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontWeight: "600", color: "var(--color-amber-600)" }}>
          <Star size={13} fill="var(--color-amber-500)" color="var(--color-amber-500)" />
          {val || 5}.0 / 5.0
        </span>
      ),
    },
    {
      header: "Status / Toggle",
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
      header: "Actions",
      accessor: "_id",
      render: (id, row) => (
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            className="action-icon-btn"
            onClick={() => openHistory(row)}
            title="View Purchase Orders History"
          >
            <History size={15} />
          </button>
          <button
            type="button"
            className="action-icon-btn danger"
            onClick={() => handleDelete(id, row)}
            title="Delete vendor"
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
          <h1>Vendor & Supplier Directory</h1>
          <p>Qualified procurement partners, tax identifiers, vendor acceptance histories, and supplier ratings</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={fetchVendors}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={16} />
            <span>New Vendor</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--color-slate-500)" }}>
          Loading vendor partners...
        </div>
      ) : vendors.length === 0 ? (
        <div className="empty-state">
          <Building2 size={48} style={{ margin: "0 auto", opacity: 0.3 }} />
          <h3>No suppliers registered</h3>
          <p>Onboard qualified vendors with verified email addresses to issue commercial purchase orders.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={vendors}
          searchPlaceholder="Search vendor name, contact, GST, email, or phone..."
        />
      )}

      {/* New Vendor Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Onboard Qualified Vendor"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreate}
              disabled={submitting}
            >
              {submitting ? "Registering..." : "Save Vendor"}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-field">
            <label>Vendor Entity / Business Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Pacific Electronics Ltd"
              value={formData.vendorName}
              onChange={(e) => setFormData({ ...formData, vendorName: e.target.value })}
            />
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>Contact Person</label>
              <input
                type="text"
                placeholder="e.g. John Doe (Key Account Rep)"
                value={formData.contactPerson}
                onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>GST Number</label>
              <input
                type="text"
                placeholder="e.g. 27AAAAA0000A1Z5"
                value={formData.gstNumber}
                onChange={(e) => setFormData({ ...formData, gstNumber: e.target.value })}
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>Corporate Email (Required for PO Dispatch) *</label>
              <input
                type="email"
                required
                placeholder="orders@supplier.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Contact Phone Number *</label>
              <input
                type="text"
                required
                placeholder="+1 555-0199"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          <div className="form-field">
            <label>Physical Address / Office Location</label>
            <textarea
              rows="2"
              placeholder="Full operational facility address..."
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          <div className="form-field">
            <label>Initial Supplier Performance Rating (1-5)</label>
            <select
              value={formData.rating}
              onChange={(e) => setFormData({ ...formData, rating: e.target.value })}
            >
              <option value="5">⭐⭐⭐⭐⭐ 5 - Preferred Vendor</option>
              <option value="4">⭐⭐⭐⭐ 4 - Standard Reliable</option>
              <option value="3">⭐⭐⭐ 3 - Probationary</option>
              <option value="2">⭐⭐ 2 - Under Review</option>
            </select>
          </div>
        </form>
      </Modal>

      {/* Vendor History Modal */}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title={`Purchase History: ${selectedVendor?.vendorName || "Vendor"}`}
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
            Loading vendor purchase records...
          </div>
        ) : !vendorHistory ? (
          <p>No records found.</p>
        ) : (
          <div>
            <div className="dashboard-grid-4" style={{ marginBottom: "16px" }}>
              <div className="stat-card" style={{ padding: "12px" }}>
                <span className="stat-card-title">Total POs</span>
                <div className="stat-value" style={{ fontSize: "18px" }}>
                  {vendorHistory.metrics?.totalOrders || 0}
                </div>
              </div>
              <div className="stat-card" style={{ padding: "12px" }}>
                <span className="stat-card-title">Total Spend</span>
                <div className="stat-value" style={{ fontSize: "18px", color: "var(--color-emerald-700)" }}>
                  ${Number(vendorHistory.metrics?.totalSpend || 0).toLocaleString()}
                </div>
              </div>
              <div className="stat-card" style={{ padding: "12px" }}>
                <span className="stat-card-title">Accepted POs</span>
                <div className="stat-value" style={{ fontSize: "18px", color: "var(--color-primary-700)" }}>
                  {vendorHistory.metrics?.acceptedOrders || 0}
                </div>
              </div>
              <div className="stat-card" style={{ padding: "12px" }}>
                <span className="stat-card-title">Pending Delivery</span>
                <div className="stat-value" style={{ fontSize: "18px", color: "var(--color-amber-600)" }}>
                  {vendorHistory.metrics?.pendingOrders || 0}
                </div>
              </div>
            </div>

            <h4 style={{ margin: "16px 0 8px 0" }}>Commercial Purchase Orders</h4>
            {vendorHistory.orders?.length === 0 ? (
              <p style={{ color: "var(--color-slate-500)", fontSize: "13px" }}>No orders issued to this vendor yet.</p>
            ) : (
              <div style={{ maxHeight: "250px", overflowY: "auto", border: "1px solid var(--color-slate-200)", borderRadius: "6px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead style={{ background: "var(--color-slate-50)" }}>
                    <tr>
                      <th style={{ padding: "6px 10px", textAlign: "left" }}>PO #</th>
                      <th style={{ padding: "6px 10px", textAlign: "left" }}>Date</th>
                      <th style={{ padding: "6px 10px", textAlign: "right" }}>Total Amount</th>
                      <th style={{ padding: "6px 10px", textAlign: "center" }}>Vendor Status</th>
                      <th style={{ padding: "6px 10px", textAlign: "center" }}>Fulfillment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorHistory.orders.map((po) => (
                      <tr key={po._id} style={{ borderTop: "1px solid var(--color-slate-100)" }}>
                        <td style={{ padding: "6px 10px", fontWeight: "600" }}>{po.purchaseOrderNumber}</td>
                        <td style={{ padding: "6px 10px" }}>{new Date(po.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: "600" }}>
                          ${Number(po.totalAmount || 0).toFixed(2)}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          <span className={`badge ${
                            po.vendorAcceptanceStatus === "ACCEPTED" ? "badge-active" :
                            po.vendorAcceptanceStatus === "REJECTED" ? "badge-inactive" :
                            "badge-pending"
                          }`}>
                            {po.vendorAcceptanceStatus || "NOT_SENT"}
                          </span>
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>
                          <span className={`badge ${po.status === "RECEIVED" ? "badge-active" : "badge-info"}`}>
                            {po.status}
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

export default VendorsPage;

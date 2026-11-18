import React, { useState, useEffect } from "react";
import {
  RotateCcw,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Truck,
  Eye,
  Building2,
  FileText,
  Package,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import axiosInstance from "../../utils/axiosConfig";
import { useAuth } from "../../context/AuthContext";

export const VendorDebitNotesPage = () => {
  const { user } = useAuth();
  const userRole = (user?.role || user?.roleName || "").toUpperCase();
  const isSuperAdmin = userRole === "SUPER_ADMIN" || userRole === "ADMIN";
  const isWarehouseManager = userRole === "WAREHOUSE_MANAGER" || isSuperAdmin;
  const isPurchaseManager = userRole === "PURCHASE_MANAGER" || isSuperAdmin;

  const [debitNotes, setDebitNotes] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);

  // Form State
  const [selectedPoId, setSelectedPoId] = useState("");
  const [selectedPoDoc, setSelectedPoDoc] = useState(null);
  const [createForm, setCreateForm] = useState({
    purchaseOrder: "",
    vendor: "",
    warehouse: "",
    reason: "Defective supplier goods",
    debitNoteNumber: "",
    remarks: "",
    items: [],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [notesRes, poRes, whRes, prodRes] = await Promise.allSettled([
        axiosInstance.get("/api/returns?returnType=PURCHASE"),
        axiosInstance.get("/api/purchase-orders"),
        axiosInstance.get("/api/warehouses"),
        axiosInstance.get("/api/products"),
      ]);

      const noteList = notesRes.status === "fulfilled" ? (notesRes.value.data?.data || notesRes.value.data || []) : [];
      const poList = poRes.status === "fulfilled" ? (poRes.value.data?.data || poRes.value.data || []) : [];
      const whList = whRes.status === "fulfilled" ? (whRes.value.data?.data || whRes.value.data || []) : [];
      const prodList = prodRes.status === "fulfilled" ? (prodRes.value.data?.data || prodRes.value.data || []) : [];

      setDebitNotes(Array.isArray(noteList) ? noteList : []);
      setPurchaseOrders(Array.isArray(poList) ? poList : []);
      setWarehouses(Array.isArray(whList) ? whList : []);
      setProducts(Array.isArray(prodList) ? prodList : []);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load vendor debit notes.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // When PO is selected, auto-populate vendor, warehouse, and product checklist
  const handleSelectPurchaseOrder = (poId) => {
    setSelectedPoId(poId);
    if (!poId) {
      setSelectedPoDoc(null);
      setCreateForm((prev) => ({
        ...prev,
        purchaseOrder: "",
        items: [],
      }));
      return;
    }

    const po = purchaseOrders.find((p) => p._id === poId);
    if (!po) return;
    setSelectedPoDoc(po);

    const items = (po.items || []).map((it) => {
      const pid = String(it.product?._id || it.product);
      const prodDoc = products.find((p) => String(p._id) === pid) || it.product;
      const orderQty = Number(it.quantity || 0);
      const recvQty = Number(it.receivedQuantity || 0);
      const targetQty = recvQty > 0 ? recvQty : orderQty;

      return {
        selected: true,
        product: pid,
        productName: prodDoc?.productName || it.product?.productName || "Product",
        sku: prodDoc?.sku || it.product?.sku || "",
        orderedQuantity: orderQty,
        receivedQuantity: recvQty,
        quantity: Math.max(1, targetQty),
        maxReturnable: Math.max(1, targetQty),
        condition: "DAMAGED",
        reason: "Defective supplier goods",
        remarks: "",
      };
    });

    setCreateForm((prev) => ({
      ...prev,
      purchaseOrder: po._id,
      vendor: po.vendor?._id || po.vendor,
      warehouse: po.warehouse?._id || po.warehouse || warehouses[0]?._id,
      debitNoteNumber: `DN-${Date.now()}`,
      items,
    }));
  };

  const handleToggleItemSelect = (idx) => {
    const updated = [...createForm.items];
    updated[idx].selected = !updated[idx].selected;
    setCreateForm((prev) => ({ ...prev, items: updated }));
  };

  const handleItemFieldChange = (idx, field, value) => {
    const updated = [...createForm.items];
    updated[idx][field] = value;
    setCreateForm((prev) => ({ ...prev, items: updated }));
  };

  const handleCreateDebitNote = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);

      const activeItems = createForm.items.filter((i) => i.selected && Number(i.quantity) > 0);
      if (!activeItems.length) {
        setToast({ type: "error", message: "Please select at least one item to return to supplier." });
        return;
      }

      const selectedPO = purchaseOrders.find((p) => p._id === createForm.purchaseOrder);
      const targetWarehouse =
        createForm.warehouse || selectedPO?.warehouse?._id || selectedPO?.warehouse || warehouses[0]?._id;
      const targetVendor = createForm.vendor || selectedPO?.vendor?._id || selectedPO?.vendor;

      if (!targetWarehouse) {
        setToast({ type: "error", message: "Warehouse facility is required for supplier debit note." });
        return;
      }

      const payload = {
        returnType: "PURCHASE",
        purchaseOrder: selectedPO?._id,
        vendor: targetVendor,
        warehouse: targetWarehouse,
        items: activeItems.map((i) => ({
          product: i.product,
          quantity: Number(i.quantity) || 1,
          condition: i.condition || "DAMAGED",
          reason: i.reason || createForm.reason,
          remarks: i.remarks || "",
        })),
        reason: createForm.reason,
        debitNoteNumber: createForm.debitNoteNumber || `DN-${Date.now()}`,
        remarks: createForm.remarks,
      };

      await axiosInstance.post("/api/returns", payload);
      setToast({ type: "success", message: "Vendor Debit Note registered successfully." });
      setIsCreateModalOpen(false);
      setSelectedPoId("");
      setSelectedPoDoc(null);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to create vendor debit note.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Dispatch return to vendor (executes RETURN_OUT inventory deduction)
  const handleCompleteDispatch = async (noteId) => {
    if (!window.confirm("Confirm outbound shipment of defective goods to supplier? This will deduct the stock from the warehouse.")) {
      return;
    }
    try {
      setSubmitting(true);
      await axiosInstance.put(`/api/returns/${noteId}/complete`);
      setToast({ type: "success", message: "Return dispatched to supplier. Warehouse stock deducted (RETURN_OUT)." });
      setIsDetailModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to complete return dispatch.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openDetailModal = (note) => {
    setSelectedNote(note);
    setIsDetailModalOpen(true);
  };

  const columns = [
    {
      header: "Debit Note Ref",
      accessor: "debitNoteNumber",
      render: (val, row) => (
        <div>
          <button
            type="button"
            onClick={() => openDetailModal(row)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontWeight: "700",
              color: "var(--color-primary-700)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {val || row.returnNumber || `DN-${String(row._id).slice(-6).toUpperCase()}`}
          </button>
          <div style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>
            Tracking: {row.returnNumber}
          </div>
        </div>
      ),
    },
    {
      header: "Originating PO",
      accessor: "purchaseOrder",
      render: (po) => (
        <span style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>
          {po?.purchaseOrderNumber || po?.poNumber || po?.orderNumber || "Direct Debit"}
        </span>
      ),
    },
    {
      header: "Vendor / Supplier",
      accessor: "vendor",
      render: (v) => (
        <div>
          <div style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>
            {v?.vendorName || v?.name || "Supplier"}
          </div>
          {v?.email && (
            <div style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>{v.email}</div>
          )}
        </div>
      ),
    },
    {
      header: "Dispatch Warehouse",
      accessor: "warehouse",
      render: (wh) => wh?.warehouseName || wh?.name || "Facility",
    },
    {
      header: "Returned Items",
      accessor: "items",
      render: (items) => (
        <div>
          {items?.map((it, idx) => (
            <div key={idx} style={{ fontSize: "12px", marginBottom: "2px" }}>
              <strong>{it.product?.productName || "Product"}</strong> &bull; Qty: {it.quantity || it.requestedQuantity}
              <span className={`badge ${it.condition === "DAMAGED" ? "badge-warning" : "badge-inactive"}`} style={{ marginLeft: "4px", fontSize: "10px" }}>
                {it.condition}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      header: "Status",
      accessor: "status",
      render: (val) => {
        let badgeClass = "badge-pending";
        if (val === "COMPLETED") badgeClass = "badge-active";
        else if (val === "APPROVED" || val === "AWAITING_RETURN") badgeClass = "badge-info";
        else if (val === "REJECTED") badgeClass = "badge-inactive";
        return <span className={`badge ${badgeClass}`}>{val}</span>;
      },
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (id, row) => (
        <div style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            className="action-icon-btn"
            onClick={() => openDetailModal(row)}
            title="View Details"
          >
            <Eye size={15} />
          </button>
          {row.status !== "COMPLETED" && (isWarehouseManager || isPurchaseManager) && (
            <button
              type="button"
              className="action-icon-btn"
              onClick={() => handleCompleteDispatch(row._id)}
              title="Dispatch to Supplier (RETURN_OUT)"
              style={{ color: "var(--color-emerald-700)" }}
            >
              <Truck size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="page-container">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Vendor Debit Notes (Supplier Returns)</h1>
          <p className="page-subtitle">
            Warehouse outbound returns for damaged, defective, or quarantined supplier stock.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" className="btn-secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          {(isWarehouseManager || isPurchaseManager) && (
            <button type="button" className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
              <Plus size={16} /> Issue Vendor Debit Note
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Total Debit Notes</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>
              <RotateCcw size={20} />
            </div>
          </div>
          <div className="stat-value">{debitNotes.length}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Recorded supplier return claims</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Awaiting Dispatch</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-warning-50)", color: "var(--color-warning-700)" }}>
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="stat-value">
            {debitNotes.filter((n) => n.status !== "COMPLETED" && n.status !== "REJECTED").length}
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Stock quarantined for return</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Completed Dispatches</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-success-50)", color: "var(--color-success-700)" }}>
              <CheckCircle size={20} />
            </div>
          </div>
          <div className="stat-value">
            {debitNotes.filter((n) => n.status === "COMPLETED").length}
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Returned & stock deducted</span>
        </div>
      </div>

      {/* Main Table */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--color-slate-500)" }}>
            Loading vendor debit notes...
          </div>
        ) : debitNotes.length === 0 ? (
          <div className="empty-state">
            <RotateCcw size={48} style={{ margin: "0 auto", opacity: 0.3 }} />
            <h3>No Vendor Debit Notes recorded</h3>
            <p>Initiate a supplier return to send defective goods back from warehouse quarantine.</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={debitNotes}
            searchPlaceholder="Filter by Debit Note, PO number, vendor, or warehouse..."
          />
        )}
      </div>

      {/* CREATE MODAL */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Issue Vendor Debit Note (Supplier Return)"
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
              onClick={handleCreateDebitNote}
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Issue Debit Note"}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateDebitNote} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Originating Purchase Order (PO) *</label>
              <select
                value={selectedPoId}
                onChange={(e) => handleSelectPurchaseOrder(e.target.value)}
                required
              >
                <option value="">Select received Purchase Order...</option>
                {purchaseOrders.length === 0 ? (
                  <option value="" disabled>No purchase orders available</option>
                ) : (
                  purchaseOrders.map((po) => (
                    <option key={po._id} value={po._id}>
                      {po.purchaseOrderNumber || po.poNumber || `PO-${String(po._id).slice(-6).toUpperCase()}`} &bull; {po.vendor?.vendorName || po.vendor?.name || "Supplier"} &bull; [{po.status}]
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="form-field">
              <label>Dispatch Facility / Warehouse *</label>
              <select
                value={createForm.warehouse}
                onChange={(e) => setCreateForm({ ...createForm, warehouse: e.target.value })}
                required
              >
                <option value="">Select warehouse...</option>
                {warehouses.map((wh) => (
                  <option key={wh._id} value={wh._id}>
                    {wh.warehouseName || wh.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedPoDoc && (
            <div style={{ background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px", border: "1px solid var(--color-slate-200)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: "700" }}>Select Products to Return</span>
                <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>
                  Vendor: {selectedPoDoc.vendor?.vendorName || selectedPoDoc.vendor?.name}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {createForm.items.map((it, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "10px",
                      background: it.selected ? "#fff" : "transparent",
                      border: it.selected ? "1px solid var(--color-primary-400)" : "1px dashed var(--color-slate-200)",
                      borderRadius: "6px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <input
                        type="checkbox"
                        checked={it.selected}
                        onChange={() => handleToggleItemSelect(idx)}
                      />
                      <div style={{ fontWeight: "700", fontSize: "13px" }}>{it.productName}</div>
                      <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>({it.sku})</span>
                      <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--color-slate-600)" }}>
                        Ordered: {it.orderedQuantity} | Received: {it.receivedQuantity}
                      </span>
                    </div>

                    {it.selected && (
                      <div className="form-grid-2" style={{ marginTop: "6px" }}>
                        <div>
                          <label style={{ fontSize: "11px" }}>Return Qty *</label>
                          <input
                            type="number"
                            min="1"
                            max={it.maxReturnable}
                            value={it.quantity}
                            onChange={(e) => handleItemFieldChange(idx, "quantity", Math.max(1, Number(e.target.value) || 1))}
                            required
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: "11px" }}>Condition</label>
                          <select
                            value={it.condition}
                            onChange={(e) => handleItemFieldChange(idx, "condition", e.target.value)}
                          >
                            <option value="DAMAGED">Damaged / Broken</option>
                            <option value="REPAIR_REQUIRED">Repair Required</option>
                            <option value="REJECTED">Rejected Intake</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-grid-2">
            <div className="form-field">
              <label>Reason for Supplier Return *</label>
              <select
                value={createForm.reason}
                onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
                required
              >
                <option value="Defective supplier goods">Defective / Manufacturing Fault</option>
                <option value="Transit damage">Damaged During Inbound Transit</option>
                <option value="Quality mismatch">Failed Quality Specifications (QA)</option>
                <option value="Wrong item delivered">Incorrect SKU Shipped by Supplier</option>
                <option value="Over-delivery">Excess Quantity Shipped</option>
              </select>
            </div>

            <div className="form-field">
              <label>Carrier / Outbound Dispatch Remarks</label>
              <input
                type="text"
                placeholder="Tracking number, return authorization, or notes..."
                value={createForm.remarks}
                onChange={(e) => setCreateForm({ ...createForm, remarks: e.target.value })}
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* DETAIL MODAL */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title="Vendor Debit Note Details"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setIsDetailModalOpen(false)}>
              Close
            </button>
            {selectedNote?.status !== "COMPLETED" && (isWarehouseManager || isPurchaseManager) && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => handleCompleteDispatch(selectedNote._id)}
                disabled={submitting}
              >
                <Truck size={16} /> Dispatch Return (RETURN_OUT)
              </button>
            )}
          </>
        }
      >
        {selectedNote && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px" }}>
              <div>
                <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Debit Note Number</span>
                <div style={{ fontWeight: "700" }}>{selectedNote.debitNoteNumber || selectedNote.returnNumber}</div>
              </div>
              <div>
                <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Status</span>
                <div><span className="badge badge-info">{selectedNote.status}</span></div>
              </div>
              <div>
                <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Vendor</span>
                <div style={{ fontWeight: "600" }}>{selectedNote.vendor?.vendorName || "Supplier"}</div>
              </div>
              <div>
                <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Warehouse Facility</span>
                <div>{selectedNote.warehouse?.warehouseName || "Facility"}</div>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: "13px", fontWeight: "700", marginBottom: "8px" }}>Returned Product Items</h4>
              <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-slate-200)", textAlign: "left" }}>
                    <th style={{ padding: "6px" }}>Product</th>
                    <th style={{ padding: "6px" }}>SKU</th>
                    <th style={{ padding: "6px" }}>Qty</th>
                    <th style={{ padding: "6px" }}>Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedNote.items?.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                      <td style={{ padding: "6px" }}>{it.product?.productName || "Product"}</td>
                      <td style={{ padding: "6px" }}>{it.product?.sku || "-"}</td>
                      <td style={{ padding: "6px", fontWeight: "700" }}>{it.quantity}</td>
                      <td style={{ padding: "6px" }}>
                        <span className="badge badge-warning">{it.condition}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedNote.remarks && (
              <div style={{ fontSize: "12px", color: "var(--color-slate-600)" }}>
                <strong>Remarks:</strong> {selectedNote.remarks}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default VendorDebitNotesPage;


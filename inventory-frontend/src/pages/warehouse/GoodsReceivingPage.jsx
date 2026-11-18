import React, { useState, useEffect } from "react";
import { PackageCheck, Truck, AlertTriangle, CheckCircle, RefreshCw, Eye, ShieldAlert, ArrowDownCircle } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import axiosInstance from "../../utils/axiosConfig";

export const GoodsReceivingPage = () => {
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // Modal State
  const [selectedPO, setSelectedPO] = useState(null);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [selectedGrn, setSelectedGrn] = useState(null);
  const [isGrnDetailModalOpen, setIsGrnDetailModalOpen] = useState(false);

  const [receiveForm, setReceiveForm] = useState({
    warehouseId: "",
    remarks: "",
    items: [],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [poRes, whRes, grRes] = await Promise.all([
        axiosInstance.get("/api/purchases"),
        axiosInstance.get("/api/warehouses"),
        axiosInstance.get("/api/goods-receipts"),
      ]);

      const poData = poRes.data?.data || poRes.data || [];
      const whData = whRes.data?.data || whRes.data || [];
      const grData = grRes.data?.data || grRes.data || [];

      // Filter POs ready for dock receiving: APPROVED, ORDERED or PARTIALLY_RECEIVED
      const pendingPOs = (Array.isArray(poData) ? poData : []).filter(
        (po) =>
          ["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"].includes(po.status) &&
          po.vendorAcceptanceStatus !== "REJECTED" &&
          (po.items || []).some((it) => (it.receivedQuantity || 0) < it.quantity)
      );

      setPurchaseOrders(pendingPOs);
      setWarehouses(Array.isArray(whData) ? whData : []);
      setReceipts(Array.isArray(grData) ? grData : []);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load receiving data.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openReceiveModal = (po) => {
    setSelectedPO(po);
    const initialItems = (po.items || []).map((it) => {
      const remaining = Math.max(0, it.quantity - (it.receivedQuantity || 0));
      return {
        product: it.product?._id || it.product,
        productName: it.product?.productName || "Item",
        sku: it.product?.sku || "",
        orderedQuantity: it.quantity,
        alreadyReceived: it.receivedQuantity || 0,
        remainingAllowed: remaining,
        receivedQuantity: remaining, // default arriving qty to remaining
        damagedQuantity: 0,
        rejectedQuantity: 0,
      };
    });

    setReceiveForm({
      warehouseId: po.warehouse?._id || po.warehouse || (warehouses[0]?._id || ""),
      receiptDate: new Date().toISOString().split("T")[0],
      remarks: "",
      items: initialItems,
    });
    setIsReceiveModalOpen(true);
  };

  const handleItemQtyChange = (index, field, value) => {
    const updated = [...receiveForm.items];
    const num = Math.max(0, Number(value) || 0);
    updated[index][field] = num;
    setReceiveForm({ ...receiveForm, items: updated });
  };

  const handleSubmitReceipt = async (e) => {
    e.preventDefault();
    if (!receiveForm.warehouseId) {
      setToast({ type: "error", message: "Please select a warehouse." });
      return;
    }

    // Validation
    for (const it of receiveForm.items) {
      const recv = Number(it.receivedQuantity || 0);
      const dmg = Number(it.damagedQuantity || 0);
      const rej = Number(it.rejectedQuantity || 0);

      if (recv > it.remainingAllowed) {
        setToast({
          type: "error",
          message: `Arriving quantity (${recv}) for ${it.productName} exceeds remaining expected (${it.remainingAllowed}).`,
        });
        return;
      }

      if (dmg + rej > recv) {
        setToast({
          type: "error",
          message: `Damaged (${dmg}) + Rejected (${rej}) cannot exceed arriving quantity (${recv}) for ${it.productName}.`,
        });
        return;
      }
    }

    if (receiveForm.receiptDate) {
      const rDate = new Date(receiveForm.receiptDate);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      if (rDate > todayEnd) {
        setToast({ type: "error", message: "Receipt date cannot be in the future." });
        return;
      }
    }

    const payload = {
      purchaseOrder: selectedPO._id,
      purchaseOrderId: selectedPO._id,
      warehouse: receiveForm.warehouseId,
      warehouseId: receiveForm.warehouseId,
      receiptDate: receiveForm.receiptDate || undefined,
      remarks: receiveForm.remarks,
      items: receiveForm.items.map((it) => ({
        product: it.product,
        receivedQuantity: Number(it.receivedQuantity || 0),
        damagedQuantity: Number(it.damagedQuantity || 0),
        rejectedQuantity: Number(it.rejectedQuantity || 0),
      })),
    };

    try {
      setSubmitting(true);
      await axiosInstance.post("/api/goods-receipts", payload);
      setToast({ type: "success", message: "Goods Receipt processed: Accepted stock added to inventory, damaged stock quarantined." });
      setIsReceiveModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to record goods receipt.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openGrnDetail = (grn) => {
    setSelectedGrn(grn);
    setIsGrnDetailModalOpen(true);
  };

  const poColumns = [
    {
      header: "PO Number",
      accessor: "purchaseOrderNumber",
      render: (val, row) => (
        <span style={{ fontWeight: "700", color: "var(--color-primary-700)" }}>
          {val || row.poNumber || `PO-${String(row._id).slice(-6).toUpperCase()}`}
        </span>
      ),
    },
    {
      header: "Vendor",
      accessor: "vendor",
      render: (val) => <span style={{ fontWeight: "600" }}>{val?.vendorName || val?.name || "Vendor"}</span>,
    },
    {
      header: "Designated Facility",
      accessor: "warehouse",
      render: (val) => val?.name || val?.warehouseName || "Central",
    },
    {
      header: "Order Items Progress",
      accessor: "items",
      render: (items) => (
        <div>
          {items?.map((it, idx) => {
            const pct = Math.min(100, Math.round(((it.receivedQuantity || 0) / it.quantity) * 100));
            return (
              <div key={idx} style={{ fontSize: "12.5px", marginBottom: "4px" }}>
                <strong>{it.product?.productName || "Product"}</strong> &bull; Ordered: {it.quantity} (Recv: {it.receivedQuantity || 0})
                <div style={{ background: "#e2e8f0", height: "4px", borderRadius: "2px", width: "100%", marginTop: "2px" }}>
                  <div style={{ background: pct === 100 ? "#10b981" : "#3b82f6", height: "100%", width: `${pct}%`, borderRadius: "2px" }} />
                </div>
              </div>
            );
          })}
        </div>
      ),
    },
    {
      header: "Status",
      accessor: "status",
      render: (val) => (
        <span className={`badge ${val === "APPROVED" ? "badge-info" : val === "PARTIALLY_RECEIVED" ? "badge-pending" : "badge-active"}`}>
          {val}
        </span>
      ),
    },
    {
      header: "Action",
      accessor: "_id",
      render: (_, row) => (
        <button
          type="button"
          className="btn-primary"
          style={{ padding: "6px 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
          onClick={() => openReceiveModal(row)}
        >
          <PackageCheck size={14} /> Receive Intake
        </button>
      ),
    },
  ];

  const grnColumns = [
    {
      header: "GRN Number",
      accessor: "grnNumber",
      render: (val, row) => (
        <button
          type="button"
          onClick={() => openGrnDetail(row)}
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
          {val || `GRN-${String(row._id).slice(-6).toUpperCase()}`}
        </button>
      ),
    },
    {
      header: "PO Reference",
      accessor: "purchaseOrder",
      render: (po) => po?.purchaseOrderNumber || po?.poNumber || "PO Ref",
    },
    {
      header: "Warehouse",
      accessor: "warehouse",
      render: (w) => w?.warehouseName || w?.name || "Facility",
    },
    {
      header: "Items Ingested",
      accessor: "items",
      render: (items) => (
        <div>
          {items?.map((it, idx) => (
            <div key={idx} style={{ fontSize: "12px" }}>
              <strong>{it.product?.productName || "Item"}</strong>: {it.acceptedQuantity || it.receivedQuantity} accepted
              {it.damagedQuantity > 0 && <span style={{ color: "#ef4444" }}> ({it.damagedQuantity} damaged)</span>}
              {it.rejectedQuantity > 0 && <span style={{ color: "#f97316" }}> ({it.rejectedQuantity} rejected)</span>}
            </div>
          ))}
        </div>
      ),
    },
    {
      header: "Received At",
      accessor: "receiptDate",
      render: (d) => (d ? new Date(d).toLocaleDateString() : "—"),
    },
    {
      header: "Received By",
      accessor: "receivedBy",
      render: (u) => u?.name || u?.email || "Dock Agent",
    },
    {
      header: "Action",
      accessor: "_id",
      render: (_, row) => (
        <button
          type="button"
          className="action-icon-btn"
          onClick={() => openGrnDetail(row)}
          title="View GRN Details"
        >
          <Eye size={15} />
        </button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700" }}>Dock Inbound Goods Receiving & GRN</h1>
          <p style={{ color: "var(--color-slate-500)", marginTop: "4px", fontSize: "14px" }}>
            Verify arriving supplier shipments against Approved POs, inspect quality, isolate damaged stock, and atomically ingest accepted inventory.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={fetchData} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Pending Dock Inbounds</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-warning-50)", color: "var(--color-warning-700)" }}>
              <Truck size={20} />
            </div>
          </div>
          <div className="stat-value">{purchaseOrders.length}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Approved POs awaiting dock intake</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Total GRNs Processed</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-success-50)", color: "var(--color-success-700)" }}>
              <CheckCircle size={20} />
            </div>
          </div>
          <div className="stat-value">{receipts.length}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Verified goods intake logs</span>
        </div>
      </div>

      {/* Pending POs */}
      <div className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
          Inbound Shipments Awaiting Dock Receiving
        </h2>
        {loading ? (
          <div style={{ textAlign: "center", padding: "32px", color: "var(--color-slate-500)" }}>
            Checking approved purchase orders...
          </div>
        ) : purchaseOrders.length === 0 ? (
          <div className="empty-state">
            <PackageCheck size={44} style={{ margin: "0 auto", opacity: 0.3 }} />
            <h3>No pending dock inbounds</h3>
            <p>All approved purchase orders have been received or none are currently scheduled.</p>
          </div>
        ) : (
          <DataTable
            columns={poColumns}
            data={purchaseOrders}
            searchPlaceholder="Filter by PO number or vendor..."
          />
        )}
      </div>

      {/* Completed GRN Log */}
      <div className="card">
        <h2 style={{ fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
          Goods Receipt Notes (GRN Audit History)
        </h2>
        {receipts.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px", color: "var(--color-slate-400)" }}>
            No goods receipt notes generated yet.
          </div>
        ) : (
          <DataTable
            columns={grnColumns}
            data={receipts}
            searchPlaceholder="Filter by GRN or PO reference..."
          />
        )}
      </div>

      {/* Receive Modal */}
      <Modal
        isOpen={isReceiveModalOpen}
        onClose={() => setIsReceiveModalOpen(false)}
        title={`Receive Goods - ${selectedPO?.purchaseOrderNumber || selectedPO?.poNumber || "PO Intake"}`}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsReceiveModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSubmitReceipt}
              disabled={submitting}
            >
              {submitting ? "Processing Intake..." : "Confirm & Update Inventory"}
            </button>
          </>
        }
      >
        <form onSubmit={handleSubmitReceipt} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-field">
            <label>Receiving Facility / Warehouse *</label>
            <select
              value={receiveForm.warehouseId}
              onChange={(e) => setReceiveForm({ ...receiveForm, warehouseId: e.target.value })}
              required
            >
              <option value="">Select facility...</option>
              {warehouses.map((w) => (
                <option key={w._id} value={w._id}>
                  {w.warehouseName || w.name} ({w.location})
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>Physical Receipt Date *</label>
            <input
              type="date"
              max={new Date().toISOString().split("T")[0]}
              required
              value={receiveForm.receiptDate || ""}
              onChange={(e) => setReceiveForm({ ...receiveForm, receiptDate: e.target.value })}
            />
          </div>

          <div className="form-field">
            <label>Item Breakdown & Quality Inspection</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
              {receiveForm.items.map((it, idx) => {
                const acceptedQty = Math.max(0, (it.receivedQuantity || 0) - (it.damagedQuantity || 0) - (it.rejectedQuantity || 0));
                return (
                  <div
                    key={idx}
                    style={{
                      padding: "12px",
                      background: "var(--color-slate-50)",
                      borderRadius: "6px",
                      border: "1px solid var(--color-slate-200)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <div style={{ fontWeight: "700", fontSize: "14px" }}>
                        {it.productName} <span style={{ fontSize: "12px", color: "var(--color-slate-500)", fontWeight: "normal" }}>({it.sku})</span>
                      </div>
                      <span className="badge badge-active" style={{ fontSize: "11.5px" }}>
                        Net Accepted: {acceptedQty}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "var(--color-slate-600)", marginBottom: "8px" }}>
                      Total Ordered: <strong>{it.orderedQuantity}</strong> &bull; Previously Received: <strong>{it.alreadyReceived}</strong> &bull; Remaining Allowed: <strong>{it.remainingAllowed}</strong>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                      <div>
                        <label style={{ fontSize: "11px", color: "var(--color-slate-600)", display: "block" }}>
                          Arriving Qty (Total) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={it.remainingAllowed}
                          value={it.receivedQuantity}
                          onChange={(e) => handleItemQtyChange(idx, "receivedQuantity", e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "11px", color: "#dc2626", display: "block" }}>
                          Damaged Qty (Quarantine)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={it.receivedQuantity}
                          value={it.damagedQuantity}
                          onChange={(e) => handleItemQtyChange(idx, "damagedQuantity", e.target.value)}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "11px", color: "#ea580c", display: "block" }}>
                          Rejected Qty (Debit)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={it.receivedQuantity}
                          value={it.rejectedQuantity}
                          onChange={(e) => handleItemQtyChange(idx, "rejectedQuantity", e.target.value)}
                        />
                      </div>
                    </div>

                    <div style={{ fontSize: "11px", color: "var(--color-slate-500)", marginTop: "6px" }}>
                      Note: Only clean accepted units ({acceptedQty}) will enter sellable stock. Damaged items ({it.damagedQuantity || 0}) go to quarantine.
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="form-field">
            <label>Receiving Notes & Carrier Bill of Lading</label>
            <textarea
              rows="2"
              value={receiveForm.remarks}
              onChange={(e) => setReceiveForm({ ...receiveForm, remarks: e.target.value })}
              placeholder="e.g. Carrier invoice #9019, seal intact, container inspected."
            />
          </div>
        </form>
      </Modal>

      {/* GRN Detail Modal */}
      {selectedGrn && (
        <Modal
          isOpen={isGrnDetailModalOpen}
          onClose={() => setIsGrnDetailModalOpen(false)}
          title={`Goods Receipt Note: ${selectedGrn.grnNumber}`}
          footer={
            <button type="button" className="btn-secondary" onClick={() => setIsGrnDetailModalOpen(false)}>
              Close
            </button>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="form-grid-2" style={{ background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px" }}>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Purchase Order</div>
                <div style={{ fontWeight: "700" }}>{selectedGrn.purchaseOrder?.purchaseOrderNumber || selectedGrn.purchaseOrder?.poNumber || "PO Ref"}</div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Received by: {selectedGrn.receivedBy?.name || "Dock Agent"}</div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Receiving Facility</div>
                <div style={{ fontWeight: "700" }}>{selectedGrn.warehouse?.warehouseName || selectedGrn.warehouse?.name}</div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>{new Date(selectedGrn.receiptDate).toLocaleString()}</div>
              </div>
            </div>

            <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-slate-200)", textAlign: "left", color: "var(--color-slate-600)" }}>
                  <th style={{ padding: "6px" }}>Product</th>
                  <th style={{ padding: "6px" }}>Total Arrived</th>
                  <th style={{ padding: "6px" }}>Accepted (Sellable)</th>
                  <th style={{ padding: "6px" }}>Damaged (Quarantined)</th>
                  <th style={{ padding: "6px" }}>Rejected</th>
                </tr>
              </thead>
              <tbody>
                {(selectedGrn.items || []).map((it, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                    <td style={{ padding: "6px", fontWeight: "600" }}>{it.product?.productName || "Product"}</td>
                    <td style={{ padding: "6px" }}>{it.receivedQuantity}</td>
                    <td style={{ padding: "6px", color: "#16a34a", fontWeight: "700" }}>{it.acceptedQuantity || it.receivedQuantity}</td>
                    <td style={{ padding: "6px", color: it.damagedQuantity > 0 ? "#dc2626" : "inherit" }}>{it.damagedQuantity || 0}</td>
                    <td style={{ padding: "6px", color: it.rejectedQuantity > 0 ? "#ea580c" : "inherit" }}>{it.rejectedQuantity || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selectedGrn.remarks && (
              <div style={{ fontSize: "12px", color: "var(--color-slate-600)", background: "#fff", padding: "8px", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
                <strong>Intake Remarks:</strong> {selectedGrn.remarks}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default GoodsReceivingPage;

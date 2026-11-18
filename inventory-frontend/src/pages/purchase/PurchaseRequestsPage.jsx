import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { Plus, Trash2, RefreshCw, Check, X, ShoppingCart, AlertCircle, CheckCircle, Info, Edit3, Eye } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import api from "../../api/axios";
import { ROLES, normalizeRole } from "../../utils/roles";

export const PurchaseRequestsPage = () => {
  const { user } = useSelector((state) => state.auth);
  const userRole = normalizeRole(user?.role);
  const isPurchaseManager = userRole === ROLES.PURCHASE_MANAGER;
  const canCreatePR = userRole === ROLES.SUPER_ADMIN || userRole === ROLES.WAREHOUSE_MANAGER;

  const [requests, setRequests] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [inventoryMap, setInventoryMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  // Reject Modal State
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);

  // Review & Item-Wise Approval Modal State
  const [reviewPr, setReviewPr] = useState(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [approvalDecisions, setApprovalDecisions] = useState([]);
  const [approvalRemarks, setApprovalRemarks] = useState("");

  // Multi-Item Purchase Request Form State
  const [formData, setFormData] = useState({
    warehouse: "",
    priority: "MEDIUM",
    requiredDeliveryDate: "",
    generalRemarks: "",
    items: [
      { product: "", quantity: 10, reason: "Low stock", remarks: "" },
    ],
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [prRes, prodRes, whRes, invRes] = await Promise.all([
        api.get("/api/purchase-requests"),
        api.get("/api/products"),
        api.get("/api/warehouses"),
        api.get("/api/inventory"),
      ]);

      setRequests(prRes.data?.data || []);
      const prods = (prodRes.data?.data || []).filter((p) => p.status === "ACTIVE");
      const whs = whRes.data?.data || [];
      const invList = invRes.data?.data || [];

      // Build product-warehouse stock lookup map: `${productId}_${warehouseId}` -> { quantity, availableStock }
      const map = {};
      invList.forEach((inv) => {
        const pId = inv.product?._id || inv.product;
        const wId = inv.warehouse?._id || inv.warehouse;
        map[`${pId}_${wId}`] = {
          totalStock: inv.quantity || 0,
          availableStock: Math.max(0, (inv.quantity || 0) - (inv.reservedStock || 0)),
        };
      });

      setProducts(prods);
      setWarehouses(whs);
      setInventoryMap(map);

      if (whs.length > 0 && !formData.warehouse) {
        setFormData((prev) => ({
          ...prev,
          warehouse: whs[0]._id,
          items: prev.items.map((it) => ({
            ...it,
            product: it.product || (prods[0]?._id || ""),
          })),
        }));
      }
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to load purchase requests.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Multi-Item Row Helpers
  const handleAddItemRow = () => {
    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { product: products[0]?._id || "", quantity: 10, reason: "Low stock", remarks: "" },
      ],
    }));
  };

  const handleRemoveItemRow = (index) => {
    if (formData.items.length <= 1) {
      setToast({ message: "A Purchase Request must contain at least one product row.", type: "error" });
      return;
    }
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  };

  const handleItemChange = (index, field, value) => {
    setFormData((prev) => {
      const updated = [...prev.items];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, items: updated };
    });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!canCreatePR) {
      setToast({
        message: "Purchase Managers cannot create purchase requests. Requests must originate from Warehouse Managers or Admin.",
        type: "error",
      });
      return;
    }

    if (!formData.warehouse) {
      setToast({ message: "Please select a target warehouse facility.", type: "error" });
      return;
    }

    if (formData.requiredDeliveryDate) {
      const chosen = new Date(formData.requiredDeliveryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (chosen < today) {
        setToast({
          message: "Required delivery date cannot be in the past. Please select today or a future date.",
          type: "error",
        });
        return;
      }
    }

    if (!formData.items || formData.items.length === 0) {
      setToast({ message: "At least one product item is required.", type: "error" });
      return;
    }

    // Check for duplicate products in rows
    const seen = new Set();
    for (const it of formData.items) {
      if (!it.product) {
        setToast({ message: "Please select a product for every row.", type: "error" });
        return;
      }
      if (seen.has(it.product)) {
        setToast({ message: "Duplicate product selected. Please combine quantities into one row.", type: "error" });
        return;
      }
      seen.add(it.product);

      const qty = Number(it.quantity);
      if (isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
        setToast({ message: "Quantity must be a positive integer greater than zero.", type: "error" });
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        warehouse: formData.warehouse,
        priority: formData.priority,
        requiredDeliveryDate: formData.requiredDeliveryDate || undefined,
        generalRemarks: formData.generalRemarks,
        items: formData.items.map((it) => {
          const prodDoc = products.find((p) => p._id === it.product);
          return {
            product: it.product,
            quantity: Number(it.quantity),
            requestedQuantity: Number(it.quantity),
            estimatedUnitPrice: prodDoc?.costPrice || prodDoc?.unitPrice || 0,
            reason: it.reason || "Low stock",
            remarks: it.remarks || "",
          };
        }),
      };

      const res = await api.post("/api/purchase-requests", payload);

      setToast({
        message: `Multi-item PR ${res.data?.data?.requestNumber || ""} created with ${formData.items.length} products.`,
        type: "success",
      });
      setIsModalOpen(false);
      setFormData({
        warehouse: warehouses[0]?._id || "",
        priority: "MEDIUM",
        requiredDeliveryDate: "",
        generalRemarks: "",
        items: [{ product: products[0]?._id || "", quantity: 10, reason: "Low stock", remarks: "" }],
      });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to submit multi-item purchase request.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Review & Item-wise Approval Modal
  const openReviewModal = (pr) => {
    setReviewPr(pr);
    setApprovalRemarks("");
    // Initialize item decision state
    const initialDecisions = (pr.items || []).map((it) => {
      const reqQty = Number(it.requestedQuantity || it.quantity);
      return {
        itemId: it._id,
        productId: it.product?._id || it.product,
        productName: it.product?.productName || "Product",
        sku: it.product?.sku || "",
        requestedQuantity: reqQty,
        approvedQuantity: it.approvedQuantity > 0 ? it.approvedQuantity : reqQty,
        rejectedQuantity: it.rejectedQuantity || 0,
        remarks: it.remarks || "",
        itemStatus: it.itemStatus || "PENDING",
      };
    });
    setApprovalDecisions(initialDecisions);
    setIsReviewModalOpen(true);
  };

  const handleApprovalDecisionChange = (idx, field, value) => {
    setApprovalDecisions((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx] };
      const reqQty = item.requestedQuantity;

      if (field === "approvedQuantity") {
        let app = Math.max(0, Math.min(reqQty, Number(value) || 0));
        item.approvedQuantity = app;
        item.rejectedQuantity = Math.max(0, reqQty - app);
      } else if (field === "rejectedQuantity") {
        let rej = Math.max(0, Math.min(reqQty, Number(value) || 0));
        item.rejectedQuantity = rej;
        item.approvedQuantity = Math.max(0, reqQty - rej);
      } else {
        item[field] = value;
      }
      updated[idx] = item;
      return updated;
    });
  };

  const handleSubmitApproval = async (e) => {
    e.preventDefault();
    if (!reviewPr) return;

    try {
      setSubmitting(true);
      await api.patch(`/api/purchase-requests/${reviewPr._id}/approve`, {
        items: approvalDecisions.map((d) => ({
          itemId: d.itemId,
          product: d.productId,
          approvedQuantity: Number(d.approvedQuantity),
          rejectedQuantity: Number(d.rejectedQuantity),
          remarks: d.remarks,
        })),
        generalRemarks: approvalRemarks,
      });

      setToast({ message: "Purchase request reviewed and updated successfully.", type: "success" });
      setIsReviewModalOpen(false);
      setReviewPr(null);
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to submit approval decisions.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickApprove = async (id) => {
    try {
      await api.patch(`/api/purchase-requests/${id}/approve`, {});
      setToast({ message: "Purchase request fully approved! You can now issue Purchase Orders to vendors.", type: "success" });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to approve request.",
        type: "error",
      });
    }
  };

  const openRejectModal = (id) => {
    setRejectingId(id);
    setRejectionReason("");
    setIsRejectModalOpen(true);
  };

  const handleConfirmReject = async (e) => {
    e.preventDefault();
    if (!rejectingId) return;

    try {
      await api.patch(`/api/purchase-requests/${rejectingId}/reject`, {
        rejectionReason: rejectionReason || "Rejected by Purchase Manager",
      });
      setToast({ message: "Purchase request rejected.", type: "success" });
      setIsRejectModalOpen(false);
      setRejectingId(null);
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to reject request.",
        type: "error",
      });
    }
  };

  const columns = [
    {
      header: "PR Number",
      accessor: "requestNumber",
      render: (val, row) => (
        <div>
          <span style={{ fontWeight: "700", color: "var(--color-primary-700)" }}>{val || row.prNumber}</span>
          {row.priority && (
            <span
              style={{
                marginLeft: "6px",
                fontSize: "10.5px",
                padding: "2px 6px",
                borderRadius: "4px",
                fontWeight: "700",
                background:
                  row.priority === "URGENT" || row.priority === "HIGH"
                    ? "var(--color-rose-100)"
                    : "var(--color-slate-100)",
                color:
                  row.priority === "URGENT" || row.priority === "HIGH"
                    ? "var(--color-rose-700)"
                    : "var(--color-slate-700)",
              }}
            >
              {row.priority}
            </span>
          )}
        </div>
      ),
    },
    {
      header: "Target Facility",
      accessor: "warehouse",
      render: (val) => (
        <div>
          <div style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>{val?.warehouseName || "—"}</div>
          <div style={{ fontSize: "11px", color: "var(--color-slate-400)" }}>{val?.location || ""}</div>
        </div>
      ),
    },
    {
      header: "Requested Products",
      accessor: "items",
      render: (items) => (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {items?.map((it, idx) => {
            const reqQty = Number(it.requestedQuantity || it.quantity);
            const appQty = Number(it.approvedQuantity || 0);
            const ordQty = Number(it.orderedQuantity || 0);
            return (
              <div
                key={idx}
                style={{
                  fontSize: "12px",
                  padding: "4px 8px",
                  background: "var(--color-slate-50)",
                  borderRadius: "4px",
                  borderLeft: `3px solid ${it.itemStatus === "APPROVED" ? "var(--color-emerald-500)" : it.itemStatus === "REJECTED" ? "var(--color-rose-500)" : "var(--color-slate-300)"}`,
                }}
              >
                <div style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>
                  {it.product?.productName || "Product"}
                  <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--color-slate-500)", marginLeft: "4px" }}>
                    ({it.product?.sku})
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-slate-600)" }}>
                  Requested: <strong>{reqQty}</strong>
                  {appQty > 0 && <> &bull; Approved: <strong style={{ color: "var(--color-emerald-700)" }}>{appQty}</strong></>}
                  {ordQty > 0 && <> &bull; Ordered: <strong style={{ color: "var(--color-primary-700)" }}>{ordQty}</strong></>}
                  {it.reason && <> &bull; <em>{it.reason}</em></>}
                </div>
              </div>
            );
          })}
        </div>
      ),
    },
    {
      header: "Overall Status",
      accessor: "status",
      render: (val, row) => {
        const st = row.overallStatus || val;
        let badgeClass = "badge-pending";
        if (st === "APPROVED" || st === "ORDERED") badgeClass = "badge-active";
        if (st === "PARTIALLY_APPROVED" || st === "PARTIALLY_ORDERED") badgeClass = "badge-info";
        if (st === "REJECTED" || st === "CANCELLED") badgeClass = "badge-inactive";

        return (
          <div>
            <span className={`badge ${badgeClass}`}>
              {st?.replace(/_/g, " ")}
            </span>
            {row.rejectionReason && (
              <div style={{ fontSize: "11px", color: "var(--color-rose-600)", marginTop: "2px" }}>
                {row.rejectionReason}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: "Requested By & Date",
      accessor: "createdAt",
      render: (val, row) => (
        <div>
          <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--color-slate-800)" }}>
            {row.requestedBy?.name || "Warehouse Lead"}
          </div>
          <div style={{ fontSize: "11px", color: "var(--color-slate-400)" }}>
            {val ? new Date(val).toLocaleDateString() : "—"}
          </div>
        </div>
      ),
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (id, row) => {
        const st = row.overallStatus || row.status;

        if (st === "PENDING" || st === "PARTIALLY_APPROVED") {
          return (
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
              {(isPurchaseManager || userRole === ROLES.SUPER_ADMIN) ? (
                <>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "3px" }}
                    onClick={() => openReviewModal(row)}
                    title="Item-wise Partial or Full Approval"
                  >
                    <Edit3 size={13} /> Review & Approve
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "3px" }}
                    onClick={() => handleQuickApprove(id)}
                    title="Quick approve all items"
                  >
                    <Check size={13} /> Quick Approve
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: "4px 8px", fontSize: "11px", color: "var(--color-rose-600)", display: "inline-flex", alignItems: "center", gap: "3px" }}
                    onClick={() => openRejectModal(id)}
                    title="Reject Request"
                  >
                    <X size={13} /> Reject
                  </button>
                </>
              ) : (
                <span className="badge badge-pending">Under Manager Review</span>
              )}
            </div>
          );
        }

        if (["APPROVED", "PARTIALLY_APPROVED", "PARTIALLY_ORDERED"].includes(st)) {
          const hasRemaining = (row.items || []).some(
            (it) => (it.remainingQuantity || it.approvedQuantity || 0) > (it.orderedQuantity || 0)
          );

          if (hasRemaining && (isPurchaseManager || userRole === ROLES.SUPER_ADMIN)) {
            return (
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <Link
                  to={`/purchase/orders?prId=${row._id}`}
                  className="btn-primary"
                  style={{
                    padding: "4px 10px",
                    fontSize: "11px",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontWeight: "600",
                  }}
                  title="Select Vendor & Generate Purchase Order"
                >
                  <ShoppingCart size={13} /> Find Vendor & Issue PO
                </Link>
              </div>
            );
          }
        }

        if (st === "ORDERED" || st === "CONVERTED_TO_PO") {
          return (
            <span className="badge badge-info" style={{ fontWeight: "600" }}>
              Fully Ordered
            </span>
          );
        }

        if (st === "REJECTED") {
          return <span className="badge badge-inactive">Rejected</span>;
        }

        return <span style={{ fontSize: "12px", color: "var(--color-slate-400)" }}>{st}</span>;
      },
    },
  ];

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-header-row">
        <div className="page-header-title">
          <h1>Purchase Requisitions (PR)</h1>
          <p>
            {isPurchaseManager
              ? "Procurement Requisition Pipeline: Review warehouse multi-product demands, approve item-wise or partial quantities, and split into vendor-specific Purchase Orders."
              : "Warehouse multi-item restocking demands, low-stock reorder triggers, and facility replenishments."}
          </p>
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
          {canCreatePR && (
            <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
              <Plus size={16} />
              <span>Create Multi-Item PR</span>
            </button>
          )}
        </div>
      </div>

      {isPurchaseManager && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--color-primary-50)", padding: "10px 14px", borderRadius: "6px", marginBottom: "16px", border: "1px solid var(--color-primary-200)" }}>
          <Info size={18} style={{ color: "var(--color-primary-700)", flexShrink: 0 }} />
          <div style={{ fontSize: "13px", color: "var(--color-primary-900)" }}>
            <strong>Purchase Manager Workflow:</strong> Review incoming requests from warehouses. You can approve individual products, approve partial quantities, or reject items. Approved demands can be converted into one or more vendor Purchase Orders via <strong>"Find Vendor & Issue PO"</strong>.
          </div>
        </div>
      )}

      {userRole === ROLES.WAREHOUSE_MANAGER && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--color-slate-50)", padding: "10px 14px", borderRadius: "6px", marginBottom: "16px", border: "1px solid var(--color-slate-200)" }}>
          <Info size={18} style={{ color: "var(--color-slate-700)", flexShrink: 0 }} />
          <div style={{ fontSize: "13px", color: "var(--color-slate-800)" }}>
            <strong>Warehouse Requisition Workflow:</strong> Create restocking demands for your facility. Click <strong>"Create Multi-Item PR"</strong> to request replenishment for low-stock inventory, specify priority, and set required delivery dates.
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--color-slate-500)" }}>
          Loading purchase requisitions...
        </div>
      ) : requests.length === 0 ? (
        <div className="empty-state card-panel">
          <h3>No Requisitions Found</h3>
          <p>No purchase demands recorded. Warehouse managers submit replenishment requests when stock hits reorder thresholds.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={requests}
          searchKey="requestNumber"
          searchPlaceholder="Search requisition by PR number..."
        />
      )}

      {/* Multi-Item Purchase Request Modal - Warehouse Manager / Super Admin */}
      {canCreatePR && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Create Multi-Item Purchase Request"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="multi-pr-form" className="btn-primary" disabled={submitting}>
                {submitting ? "Submitting Request..." : "Submit All Products for Approval"}
              </button>
            </>
          }
        >
          <form id="multi-pr-form" onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="form-grid-3">
              <div className="form-field">
                <label>Target Warehouse Facility *</label>
                <select
                  value={formData.warehouse}
                  onChange={(e) => setFormData({ ...formData, warehouse: e.target.value })}
                  required
                >
                  <option value="">Select facility...</option>
                  {warehouses.map((w) => (
                    <option key={w._id} value={w._id}>
                      {w.warehouseName} {w.isAssigned ? "★ (Your Facility)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label>Urgency / Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="URGENT">URGENT (Critical Stockout)</option>
                </select>
              </div>

              <div className="form-field">
                <label>Required Delivery Date</label>
                <input
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  value={formData.requiredDeliveryDate}
                  onChange={(e) => setFormData({ ...formData, requiredDeliveryDate: e.target.value })}
                />
              </div>
            </div>

            {/* Dynamic Product Table */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label style={{ fontWeight: "700", color: "var(--color-slate-900)" }}>
                  Requested Products ({formData.items.length})
                </label>
                <button
                  type="button"
                  onClick={handleAddItemRow}
                  className="btn-secondary"
                  style={{ padding: "4px 10px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                >
                  <Plus size={14} /> Add Product
                </button>
              </div>

              <div style={{ border: "1px solid var(--color-slate-200)", borderRadius: "6px", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead style={{ background: "var(--color-slate-100)", borderBottom: "1px solid var(--color-slate-200)" }}>
                    <tr>
                      <th style={{ padding: "8px", textAlign: "left" }}>Catalog Product *</th>
                      <th style={{ padding: "8px", textAlign: "center", width: "130px" }}>Facility Stock</th>
                      <th style={{ padding: "8px", textAlign: "left", width: "110px" }}>Requested Qty *</th>
                      <th style={{ padding: "8px", textAlign: "left", width: "150px" }}>Reason</th>
                      <th style={{ padding: "8px", textAlign: "left" }}>Remarks</th>
                      <th style={{ padding: "8px", textAlign: "center", width: "40px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.items.map((row, idx) => {
                      const stockKey = `${row.product}_${formData.warehouse}`;
                      const stockInfo = inventoryMap[stockKey] || { totalStock: 0, availableStock: 0 };

                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                          <td style={{ padding: "6px 8px" }}>
                            <select
                              value={row.product}
                              onChange={(e) => handleItemChange(idx, "product", e.target.value)}
                              required
                              style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid var(--color-slate-300)" }}
                            >
                              <option value="">Select product...</option>
                              {products.map((p) => (
                                <option key={p._id} value={p._id}>
                                  {p.sku} — {p.productName}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center", fontSize: "11.5px" }}>
                            <span style={{ color: "var(--color-slate-700)", fontWeight: "600" }}>
                              {stockInfo.totalStock} On-Hand
                            </span>
                            <div style={{ color: "var(--color-emerald-600)", fontSize: "10.5px" }}>
                              {stockInfo.availableStock} Available
                            </div>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              required
                              value={row.quantity}
                              onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                              style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid var(--color-slate-300)" }}
                            />
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <select
                              value={row.reason}
                              onChange={(e) => handleItemChange(idx, "reason", e.target.value)}
                              style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid var(--color-slate-300)" }}
                            >
                              <option value="Low stock">Low stock</option>
                              <option value="New requirement">New requirement</option>
                              <option value="Seasonal demand">Seasonal demand</option>
                              <option value="Safety buffer">Safety buffer</option>
                              <option value="Customer order demand">Customer order demand</option>
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <input
                              type="text"
                              placeholder="Optional item note..."
                              value={row.remarks}
                              onChange={(e) => handleItemChange(idx, "remarks", e.target.value)}
                              style={{ width: "100%", padding: "6px 8px", borderRadius: "4px", border: "1px solid var(--color-slate-300)" }}
                            />
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            <button
                              type="button"
                              onClick={() => handleRemoveItemRow(idx)}
                              style={{ background: "none", border: "none", color: "var(--color-rose-600)", cursor: "pointer" }}
                              title="Remove item"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="form-field">
              <label>Requisition General Remarks</label>
              <textarea
                value={formData.generalRemarks}
                onChange={(e) => setFormData({ ...formData, generalRemarks: e.target.value })}
                placeholder="Overall notes for the purchasing procurement team..."
                rows="2"
              />
            </div>
          </form>
        </Modal>
      )}

      {/* Item-Wise Approval & Review Modal for Purchase Manager */}
      {isReviewModalOpen && reviewPr && (
        <Modal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          title={`Review & Approve Requisition ${reviewPr.requestNumber || reviewPr.prNumber}`}
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setIsReviewModalOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmitApproval}
                disabled={submitting}
              >
                {submitting ? "Recording Decisions..." : "Submit Approval Decisions"}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px", fontSize: "13px" }}>
              <div><strong>Warehouse:</strong> {reviewPr.warehouse?.warehouseName} &bull; <strong>Requester:</strong> {reviewPr.requestedBy?.name}</div>
              {reviewPr.requiredDeliveryDate && (
                <div><strong>Required By:</strong> {new Date(reviewPr.requiredDeliveryDate).toLocaleDateString()}</div>
              )}
              {reviewPr.generalRemarks && <div><strong>Remarks:</strong> {reviewPr.generalRemarks}</div>}
            </div>

            <div style={{ border: "1px solid var(--color-slate-200)", borderRadius: "6px", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead style={{ background: "var(--color-slate-100)" }}>
                  <tr>
                    <th style={{ padding: "8px", textAlign: "left" }}>Product</th>
                    <th style={{ padding: "8px", textAlign: "center", width: "90px" }}>Requested</th>
                    <th style={{ padding: "8px", textAlign: "center", width: "100px" }}>Approve Qty</th>
                    <th style={{ padding: "8px", textAlign: "center", width: "90px" }}>Reject Qty</th>
                    <th style={{ padding: "8px", textAlign: "left" }}>Decision / Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {approvalDecisions.map((dec, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                      <td style={{ padding: "8px" }}>
                        <div style={{ fontWeight: "700" }}>{dec.productName}</div>
                        <div style={{ fontSize: "11px", color: "var(--color-slate-500)", fontFamily: "monospace" }}>{dec.sku}</div>
                      </td>
                      <td style={{ padding: "8px", textAlign: "center", fontWeight: "700" }}>
                        {dec.requestedQuantity}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="number"
                          min="0"
                          max={dec.requestedQuantity}
                          value={dec.approvedQuantity}
                          onChange={(e) => handleApprovalDecisionChange(idx, "approvedQuantity", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "6px",
                            textAlign: "center",
                            fontWeight: "700",
                            color: "var(--color-emerald-700)",
                            border: "1px solid var(--color-emerald-300)",
                            borderRadius: "4px",
                          }}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="number"
                          min="0"
                          max={dec.requestedQuantity}
                          value={dec.rejectedQuantity}
                          onChange={(e) => handleApprovalDecisionChange(idx, "rejectedQuantity", e.target.value)}
                          style={{
                            width: "100%",
                            padding: "6px",
                            textAlign: "center",
                            color: "var(--color-rose-700)",
                            border: "1px solid var(--color-rose-300)",
                            borderRadius: "4px",
                          }}
                        />
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="text"
                          placeholder="e.g. Approved for bulk order / Rejected due to excess stock"
                          value={dec.remarks}
                          onChange={(e) => handleApprovalDecisionChange(idx, "remarks", e.target.value)}
                          style={{ width: "100%", padding: "6px", borderRadius: "4px", border: "1px solid var(--color-slate-300)" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="form-field">
              <label>Internal Approval Remarks</label>
              <textarea
                rows="2"
                placeholder="General notes on procurement allocation..."
                value={approvalRemarks}
                onChange={(e) => setApprovalRemarks(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Entire PR Reason Modal */}
      <Modal
        isOpen={isRejectModalOpen}
        onClose={() => setIsRejectModalOpen(false)}
        title="Reject Purchase Requisition"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setIsRejectModalOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" style={{ background: "var(--color-rose-600)" }} onClick={handleConfirmReject}>
              Confirm Rejection
            </button>
          </>
        }
      >
        <form onSubmit={handleConfirmReject}>
          <div className="form-field">
            <label>Rejection Reason *</label>
            <textarea
              rows="3"
              required
              placeholder="e.g. Budget exhausted for current quarter or sufficient inventory available across sister warehouses."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default PurchaseRequestsPage;

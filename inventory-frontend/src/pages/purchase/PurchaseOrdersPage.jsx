import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, Check, X, FileText, Mail, Send, Eye, MessageSquare, AlertCircle, ShoppingCart, Trash2 } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import api from "../../api/axios";

export const PurchaseOrdersPage = () => {
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [approvedPrs, setApprovedPrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals State
  const [searchParams] = useSearchParams();
  const urlPrId = searchParams.get("prId");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCommModalOpen, setIsCommModalOpen] = useState(false);
  const [selectedOrderComm, setSelectedOrderComm] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState(null);

  // Multi-Item Form State
  const [selectedPrId, setSelectedPrId] = useState("");
  const [formData, setFormData] = useState({
    vendor: "",
    warehouse: "",
    expectedDate: "",
    remarks: "",
    items: [
      { product: "", quantity: 10, unitPrice: 10, tax: 0, discount: 0 },
    ],
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [poRes, venRes, whRes, prodRes, prRes] = await Promise.all([
        api.get("/api/purchases"),
        api.get("/api/vendors"),
        api.get("/api/warehouses"),
        api.get("/api/products"),
        api.get("/api/purchase-requests?status=APPROVED,PARTIALLY_APPROVED,PARTIALLY_ORDERED"),
      ]);

      setOrders(poRes.data?.data || []);
      const vList = (venRes.data?.data || []).filter((v) => v.status === "ACTIVE" && v.email);
      const wList = (whRes.data?.data || []).filter((w) => w.status === "ACTIVE");
      const pList = prodRes.data?.data || [];
      const rawPrList = prRes.data?.data || [];

      // Filter PRs that have at least one approved item with remaining quantity to order
      const convertiblePrs = rawPrList.filter((pr) => {
        return (pr.items || []).some((it) => {
          if (it.itemStatus === "REJECTED") return false;
          const approved = it.approvedQuantity !== undefined ? it.approvedQuantity : Number(it.quantity || it.requestedQuantity || 0);
          const ordered = Number(it.orderedQuantity || 0);
          const remaining = it.remainingQuantity !== undefined ? it.remainingQuantity : Math.max(0, approved - ordered);
          return remaining > 0;
        });
      });

      setVendors(vList);
      setWarehouses(wList);
      setProducts(pList);
      setApprovedPrs(convertiblePrs);

      if (urlPrId && convertiblePrs.length > 0) {
        const pr = convertiblePrs.find((p) => p._id === urlPrId);
        if (pr) {
          applyPrToForm(pr, vList, pList);
          setIsModalOpen(true);
        }
      } else if (vList.length > 0 && !formData.vendor) {
        setFormData((prev) => ({
          ...prev,
          vendor: vList[0]._id,
          warehouse: wList[0]?._id || "",
        }));
      }
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to load purchase orders.",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const applyPrToForm = (pr, vList = vendors, pList = products) => {
    setSelectedPrId(pr._id);

    const prItems = (pr.items || [])
      .filter((it) => {
        if (it.itemStatus === "REJECTED") return false;
        const approved = it.approvedQuantity !== undefined ? it.approvedQuantity : Number(it.quantity || it.requestedQuantity || 0);
        const ordered = Number(it.orderedQuantity || 0);
        const remaining = it.remainingQuantity !== undefined ? it.remainingQuantity : Math.max(0, approved - ordered);
        return remaining > 0;
      })
      .map((it) => {
        const prodId = it.product?._id || it.product;
        const prodObj = (pList.length ? pList : products).find((p) => p._id === prodId) || it.product;
        const approved = it.approvedQuantity !== undefined ? it.approvedQuantity : Number(it.quantity || it.requestedQuantity || 0);
        const ordered = Number(it.orderedQuantity || 0);
        const remaining = it.remainingQuantity !== undefined ? it.remainingQuantity : Math.max(0, approved - ordered);
        const price = Number(it.estimatedUnitPrice || prodObj?.costPrice || prodObj?.unitPrice || 10);

        return {
          purchaseRequestItemId: it._id,
          product: prodId,
          productName: prodObj?.productName || "Product",
          sku: prodObj?.sku || "",
          approvedQuantity: approved,
          orderedSoFar: ordered,
          remainingQuantity: remaining,
          quantity: remaining,
          unitPrice: price,
          tax: 0,
          discount: 0,
        };
      });

    setFormData((prev) => ({
      ...prev,
      vendor: prev.vendor || vList[0]?._id || "",
      warehouse: pr.warehouse?._id || pr.warehouse || prev.warehouse,
      expectedDate: pr.requiredDeliveryDate ? new Date(pr.requiredDeliveryDate).toISOString().split("T")[0] : prev.expectedDate,
      remarks: pr.generalRemarks ? `PR Note: ${pr.generalRemarks}` : prev.remarks,
      items: prItems.length > 0 ? prItems : [{ product: pList[0]?._id || "", quantity: 10, unitPrice: 10, tax: 0, discount: 0 }],
    }));
  };

  const handlePrSelect = (prId) => {
    if (!prId) {
      setSelectedPrId("");
      setFormData((prev) => ({
        ...prev,
        items: [{ product: products[0]?._id || "", quantity: 10, unitPrice: products[0]?.unitPrice || 10, tax: 0, discount: 0 }],
      }));
      return;
    }

    const pr = approvedPrs.find((p) => p._id === prId);
    if (pr) {
      applyPrToForm(pr);
    }
  };

  const handleAddItemRow = () => {
    const defaultProd = products[0];
    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          product: defaultProd?._id || "",
          quantity: 10,
          unitPrice: defaultProd?.unitPrice || 10,
          tax: 0,
          discount: 0,
        },
      ],
    }));
  };

  const handleRemoveItemRow = (index) => {
    if (formData.items.length <= 1) {
      setToast({ type: "error", message: "Purchase order must contain at least one item." });
      return;
    }
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...formData.items];
    updated[index][field] = value;

    if (field === "product") {
      const prod = products.find((p) => p._id === value);
      if (prod) {
        updated[index].unitPrice = prod.costPrice || prod.unitPrice || 0;
        updated[index].productName = prod.productName;
        updated[index].sku = prod.sku;
      }
    }
    setFormData((prev) => ({ ...prev, items: updated }));
  };

  // Calculations
  const calcSubtotal = () =>
    formData.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const calcTotalTax = () =>
    formData.items.reduce((sum, it) => sum + (Number(it.tax) || 0), 0);
  const calcTotalDiscount = () =>
    formData.items.reduce((sum, it) => sum + (Number(it.discount) || 0), 0);
  const calcNetTotal = () =>
    Math.max(0, calcSubtotal() + calcTotalTax() - calcTotalDiscount());

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!formData.vendor || !formData.warehouse || !formData.items.length) {
      setToast({ type: "error", message: "Vendor, warehouse, and at least one item are required." });
      return;
    }

    if (formData.expectedDate) {
      const chosen = new Date(formData.expectedDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (chosen < today) {
        setToast({
          type: "error",
          message: "Expected delivery date cannot be in the past. Please select today or a future date.",
        });
        return;
      }
    }

    // Validate quantities
    for (const it of formData.items) {
      const qty = Number(it.quantity);
      if (isNaN(qty) || qty <= 0) {
        setToast({ type: "error", message: "All item quantities must be greater than zero." });
        return;
      }
      if (it.remainingQuantity !== undefined && qty > it.remainingQuantity) {
        setToast({
          type: "error",
          message: `Cannot order ${qty} of ${it.productName || "item"}. Remaining approved limit is ${it.remainingQuantity}.`,
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.post("/api/purchases", {
        vendor: formData.vendor,
        warehouse: formData.warehouse,
        purchaseRequest: selectedPrId || undefined,
        items: formData.items.map((it) => ({
          product: it.product,
          purchaseRequestItemId: it.purchaseRequestItemId || undefined,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          tax: Number(it.tax || 0),
          discount: Number(it.discount || 0),
        })),
        expectedDate: formData.expectedDate || undefined,
        remarks: formData.remarks || "Commercial PO",
      });

      setToast({ message: "Purchase order created successfully.", type: "success" });
      setIsModalOpen(false);
      setSelectedPrId("");
      setFormData({
        vendor: vendors[0]?._id || "",
        warehouse: warehouses[0]?._id || "",
        expectedDate: "",
        remarks: "",
        items: [{ product: products[0]?._id || "", quantity: 10, unitPrice: 10, tax: 0, discount: 0 }],
      });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to create PO.",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      const res = await api.put(`/api/purchases/${id}/approve`);
      setToast({
        message: res.data?.message || "Purchase order approved and email dispatched to vendor.",
        type: "success",
      });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to approve PO.",
        type: "error",
      });
    }
  };

  const handleSendEmail = async (id) => {
    try {
      await api.post(`/api/purchases/${id}/send-email`);
      setToast({ message: "Purchase order email dispatched to vendor successfully.", type: "success" });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to send email to vendor.",
        type: "error",
      });
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm("Cancel this purchase order?")) return;
    try {
      await api.put(`/api/purchases/${id}/cancel`);
      setToast({ message: "Purchase order cancelled.", type: "success" });
      fetchData();
    } catch (err) {
      setToast({
        message: err.response?.data?.message || "Failed to cancel PO.",
        type: "error",
      });
    }
  };

  const openCommHistory = (order) => {
    setSelectedOrderComm(order);
    setIsCommModalOpen(true);
  };

  const openOrderDetail = (order) => {
    setSelectedOrderDetail(order);
    setIsDetailModalOpen(true);
  };

  const columns = [
    {
      header: "PO Reference",
      accessor: "purchaseOrderNumber",
      render: (val, row) => (
        <div>
          <button
            type="button"
            onClick={() => openOrderDetail(row)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontWeight: "700",
              color: "var(--color-primary-700)",
              cursor: "pointer",
              textDecoration: "underline",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            {val || `PO-${String(row._id).slice(-6).toUpperCase()}`}
          </button>
          {row.purchaseRequest && (
            <div style={{ fontSize: "11px", color: "var(--color-slate-500)", marginTop: "2px" }}>
              PR: {row.purchaseRequest.requestNumber || "Linked PR"}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Supplier / Vendor",
      accessor: "vendor",
      render: (val) => (
        <div>
          <div style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>
            {val?.vendorName || val?.name || "—"}
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-slate-400)" }}>
            {val?.email || "No email"}
          </div>
        </div>
      ),
    },
    {
      header: "Facility Warehouse",
      accessor: "warehouse",
      render: (val) => (
        <span style={{ fontWeight: "500", color: "var(--color-slate-700)" }}>
          {val?.warehouseName || val?.name || "Facility"}
        </span>
      ),
    },
    {
      header: "Items Ordered",
      accessor: "items",
      render: (items) => (
        <div>
          <span style={{ fontWeight: "600", color: "var(--color-slate-800)" }}>
            {items?.length || 0} Product{items?.length === 1 ? "" : "s"}
          </span>
          <div style={{ fontSize: "11.5px", color: "var(--color-slate-500)", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {items?.map((i) => i.product?.productName || "Item").join(", ")}
          </div>
        </div>
      ),
    },
    {
      header: "Internal Approval",
      accessor: "internalApprovalStatus",
      render: (val, row) => {
        const status = val || (row.status === "APPROVED" || row.status === "ORDERED" || row.status === "RECEIVED" ? "APPROVED" : row.status);
        return (
          <span className={`badge ${status === "APPROVED" ? "badge-active" : status === "REJECTED" ? "badge-inactive" : "badge-pending"}`}>
            {status}
          </span>
        );
      },
    },
    {
      header: "Vendor Acceptance",
      accessor: "vendorAcceptanceStatus",
      render: (val, row) => (
        <div>
          <span
            className={`badge ${
              val === "ACCEPTED"
                ? "badge-active"
                : val === "REJECTED"
                ? "badge-inactive"
                : val === "PENDING"
                ? "badge-pending"
                : "badge-draft"
            }`}
          >
            {val || "NOT_SENT"}
          </span>
          {row.vendorResponseDate && (
            <div style={{ fontSize: "11px", color: "var(--color-slate-400)", marginTop: "2px" }}>
              {new Date(row.vendorResponseDate).toLocaleDateString()}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Email Status",
      accessor: "emailDeliveryStatus",
      render: (val, row) => (
        <div>
          <span className={`badge ${val === "SENT" ? "badge-active" : val === "FAILED" ? "badge-inactive" : "badge-draft"}`}>
            {val || "NOT_SENT"}
          </span>
          {row.emailSentAt && (
            <div style={{ fontSize: "11px", color: "var(--color-slate-400)", marginTop: "2px" }}>
              {new Date(row.emailSentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Total Value",
      accessor: "totalAmount",
      render: (val) => (
        <span style={{ fontWeight: "700", color: "var(--color-slate-900)" }}>
          ${Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      header: "Fulfillment",
      accessor: "status",
      render: (val) => (
        <span
          className={`badge ${
            val === "RECEIVED"
              ? "badge-active"
              : val === "PARTIALLY_RECEIVED"
              ? "badge-pending"
              : val === "CANCELLED"
              ? "badge-inactive"
              : "badge-info"
          }`}
        >
          {val}
        </span>
      ),
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (id, row) => {
        const isApproved = row.internalApprovalStatus === "APPROVED" || row.status === "APPROVED" || row.status === "ORDERED";
        return (
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className="action-icon-btn"
              onClick={() => openOrderDetail(row)}
              title="View PO Details"
            >
              <Eye size={15} />
            </button>

            {!isApproved && row.status !== "CANCELLED" && (
              <button
                type="button"
                className="action-icon-btn"
                style={{ color: "var(--color-emerald-600)" }}
                onClick={() => handleApprove(id)}
                title="Approve PO & Dispatch Email"
              >
                <Check size={16} />
              </button>
            )}

            {isApproved && row.status !== "CANCELLED" && row.status !== "RECEIVED" && (
              <button
                type="button"
                className="action-icon-btn"
                style={{ color: "var(--color-primary-600)" }}
                onClick={() => handleSendEmail(id)}
                title={row.emailDeliveryStatus === "SENT" ? "Resend PO Email to Vendor" : "Send PO Email to Vendor"}
              >
                <Send size={15} />
              </button>
            )}

            <button
              type="button"
              className="action-icon-btn"
              onClick={() => openCommHistory(row)}
              title="View Vendor Communication History"
            >
              <MessageSquare size={15} />
            </button>

            {row.status !== "RECEIVED" && row.status !== "CANCELLED" && (
              <button
                type="button"
                className="action-icon-btn danger"
                onClick={() => handleCancel(id)}
                title="Cancel PO"
              >
                <X size={16} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-header-row">
        <div className="page-header-title">
          <h1>Purchase Orders (PO)</h1>
          <p>Commercial supplier commitments, Nodemailer automated vendor dispatch, multi-vendor PR item split, acceptance logs, and dock intake tracking</p>
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
          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={16} />
            <span>Create Purchase Order</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--color-slate-500)" }}>
          Loading commercial purchase orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <ShoppingCart size={48} style={{ margin: "0 auto", opacity: 0.3 }} />
          <h3>No purchase orders created</h3>
          <p>Create a purchase order directly or convert an approved Purchase Request to initiate procurement.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={orders}
          searchPlaceholder="Search PO reference, vendor, or status..."
        />
      )}

      {/* Create Purchase Order Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Issue Commercial Purchase Order"
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
              {submitting ? "Submitting..." : `Generate PO ($${calcNetTotal().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* PR Conversion Selector */}
          {approvedPrs.length > 0 && (
            <div className="form-field" style={{ background: "#f8fafc", padding: "12px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
              <label style={{ fontWeight: "700", color: "var(--color-primary-800)" }}>
                Convert from Approved Purchase Request (Multi-Vendor Splitting Supported)
              </label>
              <select
                value={selectedPrId}
                onChange={(e) => handlePrSelect(e.target.value)}
              >
                <option value="">-- Direct PO (Without Purchase Request) --</option>
                {approvedPrs.map((pr) => (
                  <option key={pr._id} value={pr._id}>
                    {pr.prNumber || pr.requestNumber} &bull; {pr.warehouse?.warehouseName || "Warehouse"} &bull; {pr.items?.length || 0} Items ({pr.status})
                  </option>
                ))}
              </select>
              {selectedPrId && (
                <div style={{ fontSize: "12px", color: "var(--color-slate-600)", marginTop: "6px" }}>
                  Items pre-filled with remaining approved quantities. You can adjust order quantities or remove items if ordering from multiple vendors.
                </div>
              )}
            </div>
          )}

          <div className="form-grid-2">
            <div className="form-field">
              <label>Select Qualified Vendor (Must have valid Email) *</label>
              <select
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                required
              >
                <option value="">Select vendor...</option>
                {vendors.map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.vendorName || v.name} ({v.email})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Receiving Facility Warehouse *</label>
              <select
                value={formData.warehouse}
                onChange={(e) => setFormData({ ...formData, warehouse: e.target.value })}
                required
                disabled={Boolean(selectedPrId)}
              >
                <option value="">Select warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w._id} value={w._id}>
                    {w.warehouseName || w.name} ({w.location})
                  </option>
                ))}
              </select>
              {selectedPrId && (
                <div style={{ fontSize: "11px", color: "var(--color-slate-500)", marginTop: "2px" }}>
                  Locked to PR designated receiving facility
                </div>
              )}
            </div>
          </div>

          <div className="form-field">
            <label>Expected Delivery Date</label>
            <input
              type="date"
              min={new Date().toISOString().split("T")[0]}
              value={formData.expectedDate}
              onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
            />
          </div>

          {/* Multi-Item Line Table */}
          <div style={{ border: "1px solid var(--color-slate-200)", borderRadius: "8px", padding: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: "700" }}>Order Item Lines ({formData.items.length})</span>
              {!selectedPrId && (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "4px 8px", fontSize: "12px" }}
                  onClick={handleAddItemRow}
                >
                  + Add Line
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {formData.items.map((row, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: selectedPrId ? "2.2fr 1fr 1fr 0.8fr 0.8fr 1fr auto" : "2fr 1fr 1fr 0.8fr 0.8fr 1fr auto",
                    gap: "8px",
                    alignItems: "center",
                    padding: "8px",
                    background: "var(--color-slate-50)",
                    borderRadius: "6px",
                  }}
                >
                  {/* Product Field */}
                  {selectedPrId ? (
                    <div>
                      <div style={{ fontWeight: "600", fontSize: "13px" }}>{row.productName}</div>
                      <div style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>
                        SKU: {row.sku || "N/A"} &bull; Rem: <strong style={{ color: "var(--color-primary-700)" }}>{row.remainingQuantity}</strong>
                      </div>
                    </div>
                  ) : (
                    <select
                      value={row.product}
                      onChange={(e) => handleItemChange(idx, "product", e.target.value)}
                      required
                    >
                      <option value="">Select product...</option>
                      {products.map((p) => (
                        <option key={p._id} value={p._id}>
                          {p.productName} ({p.sku})
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Quantity */}
                  <div>
                    <label style={{ fontSize: "10px", color: "var(--color-slate-500)", display: "block" }}>Order Qty</label>
                    <input
                      type="number"
                      min="1"
                      max={row.remainingQuantity !== undefined ? row.remainingQuantity : undefined}
                      placeholder="Qty"
                      value={row.quantity}
                      onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                      required
                    />
                  </div>

                  {/* Unit Price */}
                  <div>
                    <label style={{ fontSize: "10px", color: "var(--color-slate-500)", display: "block" }}>Unit Price ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Price"
                      value={row.unitPrice}
                      onChange={(e) => handleItemChange(idx, "unitPrice", e.target.value)}
                      required
                    />
                  </div>

                  {/* Tax */}
                  <div>
                    <label style={{ fontSize: "10px", color: "var(--color-slate-500)", display: "block" }}>Tax ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Tax"
                      value={row.tax || 0}
                      onChange={(e) => handleItemChange(idx, "tax", e.target.value)}
                    />
                  </div>

                  {/* Discount */}
                  <div>
                    <label style={{ fontSize: "10px", color: "var(--color-slate-500)", display: "block" }}>Disc ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Disc"
                      value={row.discount || 0}
                      onChange={(e) => handleItemChange(idx, "discount", e.target.value)}
                    />
                  </div>

                  {/* Line Total */}
                  <div style={{ textAlign: "right", fontWeight: "700", fontSize: "13px", color: "var(--color-slate-900)" }}>
                    ${Math.max(0, (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0) + (Number(row.tax) || 0) - (Number(row.discount) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>

                  {/* Remove Button */}
                  <div>
                    {formData.items.length > 1 && (
                      <button
                        type="button"
                        className="action-icon-btn danger"
                        onClick={() => handleRemoveItemRow(idx)}
                        title="Remove item from this PO"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Financial Summary */}
            <div style={{ marginTop: "12px", borderTop: "1px dashed var(--color-slate-200)", paddingTop: "8px", display: "flex", justifyContent: "flex-end", gap: "20px", fontSize: "13px" }}>
              <div>Subtotal: <strong>${calcSubtotal().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
              <div>Tax: <strong>+${calcTotalTax().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
              <div>Discount: <strong>-${calcTotalDiscount().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
              <div style={{ color: "var(--color-primary-700)", fontWeight: "800", fontSize: "14px" }}>
                Net Total: ${calcNetTotal().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <div className="form-field">
            <label>Purchase Terms / Special Remarks</label>
            <textarea
              rows="2"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              placeholder="e.g. Standard 30-day net payment terms. Quality inspection required on dock arrival."
            />
          </div>
        </form>
      </Modal>

      {/* PO Detail Modal */}
      {selectedOrderDetail && (
        <Modal
          isOpen={isDetailModalOpen}
          onClose={() => setIsDetailModalOpen(false)}
          title={`Purchase Order: ${selectedOrderDetail.purchaseOrderNumber || selectedOrderDetail.poNumber}`}
          footer={
            <button type="button" className="btn-secondary" onClick={() => setIsDetailModalOpen(false)}>
              Close
            </button>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="form-grid-2" style={{ background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px" }}>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Vendor / Supplier</div>
                <div style={{ fontWeight: "700" }}>{selectedOrderDetail.vendor?.vendorName || selectedOrderDetail.vendor?.name}</div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>{selectedOrderDetail.vendor?.email}</div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Receiving Facility</div>
                <div style={{ fontWeight: "700" }}>{selectedOrderDetail.warehouse?.warehouseName || selectedOrderDetail.warehouse?.name}</div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>{selectedOrderDetail.warehouse?.location}</div>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "8px" }}>Ordered Items Breakdown</h4>
              <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-slate-200)", textAlign: "left", color: "var(--color-slate-600)" }}>
                    <th style={{ padding: "6px" }}>Product</th>
                    <th style={{ padding: "6px" }}>Ordered</th>
                    <th style={{ padding: "6px" }}>Received</th>
                    <th style={{ padding: "6px" }}>Unit Price</th>
                    <th style={{ padding: "6px" }}>Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedOrderDetail.items || []).map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                      <td style={{ padding: "6px" }}>
                        <div style={{ fontWeight: "600" }}>{it.product?.productName || "Product"}</div>
                        <div style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>{it.product?.sku}</div>
                      </td>
                      <td style={{ padding: "6px" }}>{it.quantity}</td>
                      <td style={{ padding: "6px" }}>
                        <span style={{ color: it.receivedQuantity >= it.quantity ? "var(--color-emerald-600)" : "var(--color-amber-600)", fontWeight: "600" }}>
                          {it.receivedQuantity || 0}
                        </span>
                      </td>
                      <td style={{ padding: "6px" }}>${Number(it.unitPrice || 0).toFixed(2)}</td>
                      <td style={{ padding: "6px", fontWeight: "700" }}>${Number(it.lineTotal || (it.quantity * it.unitPrice)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: "12px", textAlign: "right", fontSize: "13px" }}>
                <div>Subtotal: <strong>${Number(selectedOrderDetail.subtotal || 0).toFixed(2)}</strong></div>
                {selectedOrderDetail.taxAmount > 0 && <div>Tax: <strong>+${Number(selectedOrderDetail.taxAmount).toFixed(2)}</strong></div>}
                {selectedOrderDetail.discountAmount > 0 && <div>Discount: <strong>-${Number(selectedOrderDetail.discountAmount).toFixed(2)}</strong></div>}
                <div style={{ fontSize: "15px", fontWeight: "800", color: "var(--color-primary-700)", marginTop: "4px" }}>
                  Total: ${Number(selectedOrderDetail.totalAmount || 0).toFixed(2)}
                </div>
              </div>
            </div>

            {selectedOrderDetail.remarks && (
              <div style={{ fontSize: "12px", color: "var(--color-slate-600)", background: "#fff", padding: "8px", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
                <strong>Remarks / Terms:</strong> {selectedOrderDetail.remarks}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Vendor Communication History Modal */}
      {selectedOrderComm && (
        <Modal
          isOpen={isCommModalOpen}
          onClose={() => setIsCommModalOpen(false)}
          title={`Vendor Dispatch Log: ${selectedOrderComm.purchaseOrderNumber}`}
          footer={
            <button type="button" className="btn-secondary" onClick={() => setIsCommModalOpen(false)}>
              Close
            </button>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div style={{ background: "var(--color-slate-50)", padding: "10px", borderRadius: "6px" }}>
                <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Nodemailer Delivery</span>
                <div style={{ fontWeight: "700" }}>{selectedOrderComm.emailDeliveryStatus || "NOT_SENT"}</div>
                {selectedOrderComm.emailSentAt && (
                  <div style={{ fontSize: "11px", color: "var(--color-slate-400)" }}>
                    {new Date(selectedOrderComm.emailSentAt).toLocaleString()}
                  </div>
                )}
              </div>
              <div style={{ background: "var(--color-slate-50)", padding: "10px", borderRadius: "6px" }}>
                <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Vendor Acceptance Status</span>
                <div style={{ fontWeight: "700" }}>{selectedOrderComm.vendorAcceptanceStatus || "PENDING"}</div>
                {selectedOrderComm.vendorResponseDate && (
                  <div style={{ fontSize: "11px", color: "var(--color-slate-400)" }}>
                    {new Date(selectedOrderComm.vendorResponseDate).toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            {selectedOrderComm.vendorToken && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px", borderRadius: "6px" }}>
                <div style={{ fontWeight: "700", fontSize: "12.5px", color: "#166534", marginBottom: "4px" }}>
                  72-Hour Vendor Response Portal Link:
                </div>
                <div style={{ fontSize: "12px", wordBreak: "break-all", color: "#15803d", fontFamily: "monospace" }}>
                  {window.location.origin}/vendor-response/{selectedOrderComm.vendorToken}
                </div>
              </div>
            )}

            {selectedOrderComm.vendorRemarks && (
              <div style={{ background: "var(--color-slate-50)", padding: "10px", borderRadius: "6px", fontSize: "13px" }}>
                <strong>Vendor Notes:</strong> {selectedOrderComm.vendorRemarks}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PurchaseOrdersPage;

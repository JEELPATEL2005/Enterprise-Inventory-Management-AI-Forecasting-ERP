import React, { useState, useEffect } from "react";
import {
  Plus,
  RotateCcw,
  CheckCircle,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  XCircle,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  Eye,
  Check,
  X,
  Truck,
  Wrench,
  DollarSign,
  PackageCheck,
  Package,
} from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import axiosInstance from "../../utils/axiosConfig";
import { useAuth } from "../../context/AuthContext";

export const ReturnsPage = () => {
  const { user } = useAuth();
  const userRole = (user?.role || user?.roleName || "").toUpperCase();
  const isSuperAdmin = userRole === "SUPER_ADMIN" || userRole === "ADMIN";
  const isSalesManager = userRole === "SALES_MANAGER" || isSuperAdmin;
  const isWarehouseManager = false; // Warehouse Manager removed from Customer RMA intake

  const [returns, setReturns] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // 7-day Return Policy Filter & Override
  const [filter7DaysOnly, setFilter7DaysOnly] = useState(true);
  const [overridePolicy, setOverridePolicy] = useState(false);

  // Create Form State
  const [selectedSoId, setSelectedSoId] = useState("");
  const [selectedSoDoc, setSelectedSoDoc] = useState(null);
  const [createForm, setCreateForm] = useState({
    salesOrder: "",
    warehouse: "",
    customer: "",
    reason: "Defective item",
    refundAmount: 0,
    remarks: "",
    items: [],
  });

  // Action Modals State
  const [selectedRma, setSelectedRma] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isInspectModalOpen, setIsInspectModalOpen] = useState(false);
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);

  // Approval Form
  const [approveForm, setApproveForm] = useState({ items: [], remarks: "" });

  // Receiving Form
  const [receiveForm, setReceiveForm] = useState({ items: [], dockRemarks: "" });

  // Inspection Form (4-Tier)
  const [inspectForm, setInspectForm] = useState({ items: [], inspectionRemarks: "" });

  // Resolution Form
  const [resolveForm, setResolveForm] = useState({
    resolutionType: "REFUND",
    refundAmount: 0,
    remarks: "",
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [retRes, soRes, whRes, prodRes] = await Promise.allSettled([
        axiosInstance.get("/api/returns?returnType=SALES"),
        axiosInstance.get("/api/sales-orders"),
        axiosInstance.get("/api/warehouses"),
        axiosInstance.get("/api/products"),
      ]);

      const retList = retRes.status === "fulfilled" ? (retRes.value.data?.data || retRes.value.data || []) : [];
      const soList = soRes.status === "fulfilled" ? (soRes.value.data?.data || soRes.value.data || []) : [];
      const whList = whRes.status === "fulfilled" ? (whRes.value.data?.data || whRes.value.data || []) : [];
      const prodList = prodRes.status === "fulfilled" ? (prodRes.value.data?.data || prodRes.value.data || []) : [];

      setReturns(Array.isArray(retList) ? retList : []);
      setSalesOrders(Array.isArray(soList) ? soList : []);
      setWarehouses(Array.isArray(whList) ? whList : []);
      setProducts(Array.isArray(prodList) ? prodList : []);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load customer returns.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Compute delivery details and 7-day return window eligibility
  const getDeliveryInfo = (so) => {
    if (!so) return { isDeliverable: false, deliveryDate: null, daysAgo: 0, isWithin7Days: false, daysRemaining: 0 };
    const deliverableStatuses = ["DELIVERED", "FULFILLED", "SHIPPED"];
    const isDeliverable =
      deliverableStatuses.includes(so.status) || so.delivery?.status === "DELIVERED";

    const deliveryDateRaw =
      so.delivery?.deliveredAt ||
      so.deliveryDate ||
      so.updatedAt ||
      so.orderDate ||
      so.createdAt;

    const deliveryDate = deliveryDateRaw ? new Date(deliveryDateRaw) : null;
    let daysAgo = 0;
    if (deliveryDate) {
      daysAgo = Math.floor((Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24));
    }
    const isWithin7Days = daysAgo >= 0 && daysAgo <= 7;
    const daysRemaining = Math.max(0, 7 - daysAgo);

    return {
      isDeliverable,
      deliveryDate,
      daysAgo,
      isWithin7Days,
      daysRemaining,
    };
  };

  // Filter deliverable sales orders and apply 7-day return period rule
  const deliverableSalesOrders = salesOrders.filter((so) => getDeliveryInfo(so).isDeliverable);
  const displaySalesOrders = deliverableSalesOrders.filter((so) => {
    if (!filter7DaysOnly) return true;
    return getDeliveryInfo(so).isWithin7Days;
  });

  // When Sales Order is selected in Create Modal, populate order items with max returnable calculation
  const handleSelectSalesOrder = (soId) => {
    setSelectedSoId(soId);
    setOverridePolicy(false);
    if (!soId) {
      setSelectedSoDoc(null);
      setCreateForm((prev) => ({ ...prev, salesOrder: "", items: [] }));
      return;
    }

    const so = salesOrders.find((s) => s._id === soId);
    if (!so) return;
    setSelectedSoDoc(so);

    // Calculate previously returned quantities for this sales order from existing non-rejected returns
    const returnedMap = {};
    returns
      .filter((r) => (r.salesOrder?._id === soId || r.salesOrder === soId) && r.status !== "REJECTED")
      .forEach((r) => {
        (r.items || []).forEach((it) => {
          const pid = String(it.product?._id || it.product);
          returnedMap[pid] = (returnedMap[pid] || 0) + Number(it.quantity || it.requestedQuantity || 0);
        });
      });

    const items = (so.items || []).map((it) => {
      const pid = String(it.product?._id || it.product);
      const orderedQty = Number(it.quantity || 0);
      const prevReturned = returnedMap[pid] || 0;
      const maxReturnable = Math.max(0, orderedQty - prevReturned);

      return {
        selected: maxReturnable > 0,
        product: pid,
        productName: it.product?.productName || "Product",
        sku: it.product?.sku || "",
        unitPrice: it.unitPrice || 0,
        orderedQuantity: orderedQty,
        previouslyReturned: prevReturned,
        maxReturnable,
        quantity: maxReturnable > 0 ? 1 : 0,
        condition: "GOOD",
        reason: "Defective item",
        remarks: "",
      };
    });

    setCreateForm((prev) => ({
      ...prev,
      salesOrder: so._id,
      customer: so.customer?._id || so.customer,
      warehouse: so.warehouse?._id || so.warehouse,
      refundAmount: 0,
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

  // Submit New Customer RMA
  const handleCreateReturn = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);

      if (!createForm.salesOrder) {
        setToast({ type: "error", message: "Please select an originating sales order." });
        return;
      }

      const activeItems = createForm.items.filter((i) => i.selected && Number(i.quantity) > 0);
      if (!activeItems.length) {
        setToast({ type: "error", message: "Please select at least one item with quantity > 0 to return." });
        return;
      }

      for (const it of activeItems) {
        if (Number(it.quantity) > it.maxReturnable) {
          setToast({
            type: "error",
            message: `Return quantity (${it.quantity}) for ${it.productName} exceeds remaining returnable (${it.maxReturnable}).`,
          });
          return;
        }
      }

      const payload = {
        returnType: "SALES",
        salesOrder: createForm.salesOrder,
        customer: createForm.customer,
        warehouse: createForm.warehouse,
        overridePolicy: Boolean(overridePolicy),
        items: activeItems.map((i) => ({
          product: i.product,
          quantity: Number(i.quantity),
          condition: i.condition,
          reason: i.reason,
          remarks: i.remarks,
        })),
        reason: createForm.reason,
        refundAmount: Number(createForm.refundAmount) || 0,
        remarks: createForm.remarks,
      };

      await axiosInstance.post("/api/returns", payload);
      setToast({ type: "success", message: "Customer RMA return case registered successfully." });

      setIsCreateModalOpen(false);
      setSelectedSoId("");
      setSelectedSoDoc(null);
      setOverridePolicy(false);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to create customer return record.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Approval Modal
  const openApproveModal = (rma) => {
    setSelectedRma(rma);
    setApproveForm({
      remarks: rma.remarks || "",
      items: (rma.items || []).map((it) => {
        const reqQty = Number(it.requestedQuantity || it.quantity || 0);
        return {
          itemId: it._id,
          productName: it.product?.productName || "Product",
          sku: it.product?.sku || "",
          requestedQuantity: reqQty,
          approvedQuantity: reqQty,
          rejectedQuantity: 0,
          resolution: it.resolution || "PENDING",
          remarks: it.remarks || "",
        };
      }),
    });
    setIsApproveModalOpen(true);
  };

  // Submit Approval
  const handleSubmitApprove = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload = {
        remarks: approveForm.remarks,
        items: approveForm.items.map((it) => ({
          itemId: it.itemId,
          approvedQuantity: Number(it.approvedQuantity),
          rejectedQuantity: Number(it.rejectedQuantity),
          resolution: it.resolution,
          remarks: it.remarks,
        })),
      };

      await axiosInstance.patch(`/api/returns/${selectedRma._id}/approve`, payload);
      setToast({ type: "success", message: "RMA review and item-wise approval recorded." });
      setIsApproveModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to approve RMA.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Reject entire RMA
  const handleRejectRma = async (id) => {
    const reason = window.prompt("Enter rejection reason:");
    if (!reason) return;
    try {
      await axiosInstance.put(`/api/returns/${id}/status`, { status: "REJECTED", remarks: reason });
      setToast({ type: "success", message: "Return request rejected." });
      setIsApproveModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({ type: "error", message: err.response?.data?.message || "Failed to reject return." });
    }
  };

  // Open Dock Receiving Modal
  const openReceiveModal = (rma) => {
    setSelectedRma(rma);
    setReceiveForm({
      dockRemarks: "",
      items: (rma.items || []).map((it) => {
        const approved = Number(it.approvedQuantity || it.requestedQuantity || it.quantity);
        const already = Number(it.receivedQuantity || 0);
        const remaining = Math.max(0, approved - already);
        return {
          itemId: it._id,
          productName: it.product?.productName || "Product",
          sku: it.product?.sku || "",
          approvedQuantity: approved,
          alreadyReceived: already,
          remainingToReceive: remaining,
          receivedQuantity: remaining,
        };
      }),
    });
    setIsReceiveModalOpen(true);
  };

  // Submit Dock Receiving
  const handleSubmitReceive = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload = {
        dockRemarks: receiveForm.dockRemarks || "Parcel checked in at warehouse dock",
        items: receiveForm.items.map((it) => ({
          itemId: it.itemId,
          receivedQuantity: Number(it.receivedQuantity || 0),
        })),
      };

      await axiosInstance.patch(`/api/returns/${selectedRma._id}/receive`, payload);
      setToast({
        type: "success",
        message: "Goods checked in at receiving dock. Physical inventory untouched pending inspection.",
      });
      setIsReceiveModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to receive return at dock.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Open 4-Tier Inspection Modal
  const openInspectModal = (rma) => {
    setSelectedRma(rma);
    setInspectForm({
      inspectionRemarks: "",
      items: (rma.items || []).map((it) => {
        const receivedLimit = Number(it.receivedQuantity || it.approvedQuantity || it.quantity);
        const alreadyInspected = Number(it.inspectedQuantity || 0);
        const remainingToInspect = Math.max(0, receivedLimit - alreadyInspected);
        return {
          itemId: it._id,
          product: it.product?._id || it.product,
          productName: it.product?.productName || "Product",
          sku: it.product?.sku || "",
          receivedLimit,
          alreadyInspected,
          remainingToInspect,
          goodQuantity: remainingToInspect, // default clean restock
          damagedQuantity: 0,
          repairQuantity: 0,
          rejectedQuantity: 0,
          remarks: "",
        };
      }),
    });
    setIsInspectModalOpen(true);
  };

  // Submit 4-Tier Inspection
  const handleSubmitInspect = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      for (const it of inspectForm.items) {
        const sum =
          Number(it.goodQuantity || 0) +
          Number(it.damagedQuantity || 0) +
          Number(it.repairQuantity || 0) +
          Number(it.rejectedQuantity || 0);

        if (sum > it.remainingToInspect) {
          setToast({
            type: "error",
            message: `Total inspected (${sum}) for ${it.productName} exceeds remaining uninspected (${it.remainingToInspect}).`,
          });
          return;
        }
      }

      const payload = {
        inspectionRemarks: inspectForm.inspectionRemarks || "4-tier quality disposition complete",
        items: inspectForm.items.map((it) => ({
          itemId: it.itemId,
          goodQuantity: Number(it.goodQuantity || 0),
          damagedQuantity: Number(it.damagedQuantity || 0),
          repairQuantity: Number(it.repairQuantity || 0),
          rejectedQuantity: Number(it.rejectedQuantity || 0),
          remarks: it.remarks,
        })),
      };

      await axiosInstance.patch(`/api/returns/${selectedRma._id}/inspect`, payload);
      setToast({
        type: "success",
        message: "Quality inspection processed: Good stock restocked, damaged/repair stock quarantined.",
      });
      setIsInspectModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to process inspection.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Decoupled Resolution Modal
  const openResolveModal = (rma) => {
    setSelectedRma(rma);
    setResolveForm({
      resolutionType: "REFUND",
      refundAmount: Number(rma.totalRefundAmount || rma.refundAmount || 0),
      remarks: "",
    });
    setIsResolveModalOpen(true);
  };

  // Submit Resolution
  const handleSubmitResolve = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const payload = {
        resolutionType: resolveForm.resolutionType,
        refundAmount: Number(resolveForm.refundAmount || 0),
        remarks: resolveForm.remarks,
      };

      await axiosInstance.patch(`/api/returns/${selectedRma._id}/resolve`, payload);
      setToast({
        type: "success",
        message:
          resolveForm.resolutionType === "REFUND"
            ? "Credit Note issued and RMA marked completed."
            : "Warranty Replacement Sales Order dispatched and RMA completed.",
      });
      setIsResolveModalOpen(false);
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to resolve RMA.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openDetailModal = (rma) => {
    setSelectedRma(rma);
    setIsDetailModalOpen(true);
  };

  const filteredReturns = returns.filter((r) => (r.returnType || "SALES") === "SALES");

  const columns = [
    {
      header: "RMA Reference",
      accessor: "returnNumber",
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
            {val || row.rmaNumber || `RET-${String(row._id).slice(-6).toUpperCase()}`}
          </button>
          {row.creditNoteNumber && (
            <div style={{ fontSize: "11px", color: "var(--color-emerald-600)", fontWeight: "600" }}>
              Credit Note: {row.creditNoteNumber}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Customer",
      accessor: "customer",
      render: (c) => (
        <span style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>
          {c?.customerName || c?.name || "Client"}
        </span>
      ),
    },
    {
      header: "Originating Sales Order",
      accessor: "salesOrder",
      render: (so) => so?.salesOrderNumber || "SO Ref",
    },
    {
      header: "Items Breakdown",
      accessor: "items",
      render: (items) => (
        <div>
          {items?.map((it, idx) => (
            <div key={idx} style={{ fontSize: "12px", marginBottom: "2px" }}>
              <strong>{it.product?.productName || "Product"}</strong> &bull; Qty: {it.requestedQuantity || it.quantity}
              {it.inspectedQuantity > 0 && (
                <span style={{ color: "var(--color-emerald-700)", marginLeft: "4px" }}>
                  ({it.goodQuantity || 0} Good, {it.damagedQuantity || 0} Dmg, {it.repairQuantity || 0} Rep)
                </span>
              )}
            </div>
          ))}
        </div>
      ),
    },
    {
      header: "Stage / Status",
      accessor: "status",
      render: (val, row) => {
        let badgeClass = "badge-pending";
        if (val === "COMPLETED") badgeClass = "badge-active";
        else if (val === "APPROVED" || val === "AWAITING_RETURN") badgeClass = "badge-info";
        else if (val === "RECEIVED") badgeClass = "badge-warning";
        else if (val === "INSPECTED") badgeClass = "badge-primary";
        else if (val === "REJECTED") badgeClass = "badge-inactive";
        return (
          <div>
            <span className={`badge ${badgeClass}`}>{val}</span>
            {row.resolutionStatus && row.resolutionStatus !== "NOT_RESOLVED" && (
              <div style={{ fontSize: "10.5px", color: "var(--color-emerald-700)", fontWeight: "600", marginTop: "2px" }}>
                {row.resolutionStatus}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: "Workflow Actions",
      accessor: "_id",
      render: (id, row) => {
        const isSalesReturn = (row.returnType || "SALES") === "SALES";
        const isPending = row.status === "REQUESTED" || row.status === "PENDING";
        const isApproved = row.status === "APPROVED" || row.status === "PARTIALLY_APPROVED" || row.status === "AWAITING_RETURN";
        const isReceived = row.status === "RECEIVED" || row.status === "PARTIALLY_RECEIVED";
        const isInspected = row.status === "INSPECTED";
        const isCompleted = row.status === "COMPLETED";

        return (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="action-icon-btn"
              onClick={() => openDetailModal(row)}
              title="View RMA Details"
            >
              <Eye size={15} />
            </button>

            {/* 1. Review & Approve (Sales Manager / Super Admin) */}
            {isPending && isSalesReturn && isSalesManager && (
              <button
                type="button"
                className="btn-primary"
                style={{ padding: "3px 8px", fontSize: "11px" }}
                onClick={() => openApproveModal(row)}
              >
                Approve RMA
              </button>
            )}

            {/* 2. Dock Receiving Check-in (Warehouse Manager / Super Admin) */}
            {(isApproved || (isReceived && row.overallStatus === "PARTIALLY_RECEIVED")) && isWarehouseManager && (
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "3px 8px", fontSize: "11px", borderColor: "#f59e0b", color: "#b45309" }}
                onClick={() => openReceiveModal(row)}
                title="Dock Check-in (Physical Receiving)"
              >
                <Truck size={12} style={{ marginRight: "3px" }} /> Dock Receive
              </button>
            )}

            {/* 3. 4-Tier Inspection (Warehouse Manager / Super Admin) */}
            {(isReceived || isInspected) && !isCompleted && isWarehouseManager && (
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "3px 8px", fontSize: "11px", borderColor: "#3b82f6", color: "#1d4ed8" }}
                onClick={() => openInspectModal(row)}
                title="Quality Inspection (Good/Damaged/Repair/Reject)"
              >
                <ShieldCheck size={12} style={{ marginRight: "3px" }} /> 4-Tier Inspect
              </button>
            )}

            {/* 4. Decoupled Resolution (Sales Manager / Super Admin) */}
            {(isInspected || isReceived || isApproved) && !isCompleted && isSalesReturn && isSalesManager && (
              <button
                type="button"
                className="btn-primary"
                style={{ padding: "3px 8px", fontSize: "11px", background: "var(--color-emerald-600)" }}
                onClick={() => openResolveModal(row)}
                title="Resolve RMA (Credit Note or Replacement)"
              >
                <DollarSign size={12} style={{ marginRight: "3px" }} /> Settle RMA
              </button>
            )}

            {/* Reject option for pending */}
            {isPending && isSalesManager && (
              <button
                type="button"
                className="action-icon-btn danger"
                onClick={() => handleRejectRma(id)}
                title="Reject RMA"
              >
                <X size={15} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700" }}>
            {isWarehouseManager && !isSalesManager
              ? "Customer RMA Dock Receiving & Quality Inspection"
              : "Customer Returns & RMA Management"}
          </h1>
          <p style={{ color: "var(--color-slate-500)", marginTop: "4px", fontSize: "14px" }}>
            {isWarehouseManager && !isSalesManager
              ? "Check in physical customer return shipments at the warehouse dock and execute 4-tier inspection to restock sellable, damaged, or repair inventory."
              : "Commercial customer returns: Multi-item Customer RMA registration, Sales Manager authorization, and Credit Note or Replacement settlements within the 7-day policy window."}
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" className="btn-secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
          {isSalesManager && (
            <button type="button" className="btn-primary" onClick={() => setIsCreateModalOpen(true)}>
              <Plus size={16} /> Open Customer RMA
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Total Return Cases</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>
              <RotateCcw size={20} />
            </div>
          </div>
          <div className="stat-value">{returns.length}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Total RMA & Debit Cases</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Pending Approval / Dock</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-warning-50)", color: "var(--color-warning-700)" }}>
              <AlertTriangle size={20} />
            </div>
          </div>
          <div className="stat-value">
            {returns.filter((r) => ["REQUESTED", "APPROVED", "AWAITING_RETURN", "RECEIVED"].includes(r.status)).length}
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Awaiting dock intake or inspection</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Completed Settlements</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-success-50)", color: "var(--color-success-700)" }}>
              <CheckCircle size={20} />
            </div>
          </div>
          <div className="stat-value">
            {returns.filter((r) => r.status === "COMPLETED").length}
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Restocked & Resolved Cases</span>
        </div>
      </div>

      {/* Main Table */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px", color: "var(--color-slate-500)" }}>
            Loading return cases...
          </div>
        ) : filteredReturns.length === 0 ? (
          <div className="empty-state">
            <RotateCcw size={48} style={{ margin: "0 auto", opacity: 0.3 }} />
            <h3>No return cases recorded</h3>
            <p>Customer RMA requests and vendor supplier returns will be tracked here.</p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredReturns}
            searchPlaceholder="Filter by RMA number, customer, sales order, or status..."
          />
        )}
      </div>

      {/* CREATE RETURN MODAL */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Register New Return Case (RMA)"
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
              onClick={handleCreateReturn}
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit Return Case"}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateReturn} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="form-field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ margin: 0 }}>Originating Sales Order *</label>
                  <label style={{ fontSize: "11.5px", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "var(--color-slate-600)", fontWeight: "500" }}>
                    <input
                      type="checkbox"
                      checked={filter7DaysOnly}
                      onChange={(e) => setFilter7DaysOnly(e.target.checked)}
                    />
                    Only show orders delivered within 7 days
                  </label>
                </div>
                <select
                  value={selectedSoId}
                  onChange={(e) => handleSelectSalesOrder(e.target.value)}
                  required
                >
                  <option value="">Select delivered / fulfilled sales order...</option>
                  {displaySalesOrders.length === 0 ? (
                    <option value="" disabled>
                      {filter7DaysOnly
                        ? "No orders delivered within the last 7 days (uncheck above to view older delivered orders)"
                        : "No deliverable sales orders found"}
                    </option>
                  ) : (
                    displaySalesOrders.map((so) => {
                      const info = getDeliveryInfo(so);
                      const deliveryText = info.daysAgo === 0 ? "Delivered today" : `Delivered ${info.daysAgo}d ago`;
                      const windowText = info.isWithin7Days ? `(${info.daysRemaining}d left to return)` : "[Policy Expired]";
                      return (
                        <option key={so._id} value={so._id}>
                          {so.salesOrderNumber || `SO-${String(so._id).slice(-6).toUpperCase()}`} &bull; {so.customer?.customerName || so.customer?.name || "Client"} (${Number(so.totalAmount || 0).toFixed(2)}) &bull; [{so.status}] &bull; {deliveryText} {windowText}
                        </option>
                      );
                    })
                  )}
                </select>
                <div style={{ marginTop: "4px", fontSize: "11.5px", color: filter7DaysOnly ? "var(--color-primary-700)" : "var(--color-slate-500)" }}>
                  {filter7DaysOnly ? (
                    <span>🛡️ <strong>7-Day Policy Active:</strong> Showing {displaySalesOrders.length} deliverable order(s) delivered within the past 7 days.</span>
                  ) : (
                    <span>ℹ️ Showing all {displaySalesOrders.length} delivered order(s). Orders delivered &gt; 7 days ago require policy override.</span>
                  )}
                </div>
              </div>

              {selectedSoDoc && (
                <>
                  {getDeliveryInfo(selectedSoDoc).isWithin7Days ? (
                    <div style={{ background: "var(--color-emerald-50)", border: "1px solid var(--color-emerald-200)", padding: "10px 14px", borderRadius: "6px", fontSize: "12px", color: "var(--color-emerald-800)", display: "flex", alignItems: "center", gap: "8px" }}>
                      <CheckCircle size={16} color="var(--color-emerald-600)" />
                      <span>
                        <strong>Eligible for Return:</strong> Delivered {getDeliveryInfo(selectedSoDoc).daysAgo === 0 ? "today" : `${getDeliveryInfo(selectedSoDoc).daysAgo} days ago`}. You have <strong>{getDeliveryInfo(selectedSoDoc).daysRemaining} day(s) remaining</strong> under the 7-day return policy.
                      </span>
                    </div>
                  ) : (
                    <div style={{ background: "var(--color-warning-50)", border: "1px solid var(--color-warning-300)", padding: "10px 14px", borderRadius: "6px", fontSize: "12px", color: "var(--color-warning-800)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: "700" }}>
                        <AlertTriangle size={16} /> 7-Day Return Policy Expired
                      </div>
                      <div style={{ marginTop: "4px" }}>
                        This order was delivered {getDeliveryInfo(selectedSoDoc).daysAgo} days ago. Standard policy restricts customer returns to within 7 days of delivery.
                      </div>
                      {(isSuperAdmin || isSalesManager) && (
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px", fontWeight: "600", cursor: "pointer", color: "var(--color-slate-900)" }}>
                          <input
                            type="checkbox"
                            checked={overridePolicy}
                            onChange={(e) => setOverridePolicy(e.target.checked)}
                          />
                          Manager / Admin Override: Authorize return after 7-day policy window
                        </label>
                      )}
                    </div>
                  )}
                </>
              )}

              {selectedSoDoc && (
                <div style={{ background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px", border: "1px solid var(--color-slate-200)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700" }}>Select Products to Return</span>
                    <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>
                      Customer: {selectedSoDoc.customer?.customerName || selectedSoDoc.customer?.name} &bull; Facility: {selectedSoDoc.warehouse?.warehouseName || selectedSoDoc.warehouse?.name}
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
                          opacity: it.maxReturnable === 0 ? 0.5 : 1,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                          <input
                            type="checkbox"
                            checked={it.selected}
                            disabled={it.maxReturnable === 0}
                            onChange={() => handleToggleItemSelect(idx)}
                          />
                          <div style={{ fontWeight: "700", fontSize: "13px" }}>{it.productName}</div>
                          <span style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>({it.sku})</span>
                          <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--color-slate-600)" }}>
                            Sold: {it.orderedQuantity} | Returned: {it.previouslyReturned} | <strong>Max Returnable: {it.maxReturnable}</strong>
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
                                onChange={(e) => handleItemFieldChange(idx, "quantity", Math.max(1, Math.min(it.maxReturnable, Number(e.target.value) || 1)))}
                                required
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: "11px" }}>Initial Condition</label>
                              <select
                                value={it.condition}
                                onChange={(e) => handleItemFieldChange(idx, "condition", e.target.value)}
                              >
                                <option value="GOOD">Good / Sellable</option>
                                <option value="DAMAGED">Damaged / Broken</option>
                                <option value="REPAIR_REQUIRED">Repair Required</option>
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
                  <label>Primary Return Reason *</label>
                  <select
                    value={createForm.reason}
                    onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
                    required
                  >
                    <option value="Defective item">Defective / Malfunctioning</option>
                    <option value="Wrong item delivered">Wrong Item Shipped</option>
                    <option value="Transit damage">Damaged During Transit</option>
                    <option value="Customer remorse">Customer Cancellation / Remorse</option>
                    <option value="Quality mismatch">Quality Did Not Match Expectation</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Claimed Refund Amount ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={createForm.refundAmount}
                    onChange={(e) => setCreateForm({ ...createForm, refundAmount: e.target.value })}
                  />
                </div>
              </div>

          <div className="form-field">
            <label>Customer / Internal Notes</label>
            <textarea
              rows="2"
              value={createForm.remarks}
              onChange={(e) => setCreateForm({ ...createForm, remarks: e.target.value })}
              placeholder="e.g. Customer reported packaging was torn on delivery."
            />
          </div>
        </form>
      </Modal>

      {/* APPROVE RMA MODAL (Sales Manager) */}
      {selectedRma && (
        <Modal
          isOpen={isApproveModalOpen}
          onClose={() => setIsApproveModalOpen(false)}
          title={`Review & Authorize RMA: ${selectedRma.returnNumber || selectedRma.rmaNumber}`}
          footer={
            <>
              <button
                type="button"
                className="btn-secondary"
                style={{ color: "var(--color-rose-600)" }}
                onClick={() => handleRejectRma(selectedRma._id)}
              >
                Reject Entire RMA
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmitApprove}
                disabled={submitting}
              >
                {submitting ? "Authorizing..." : "Confirm Item Approval"}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmitApprove} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "var(--color-slate-600)" }}>
              Review requested quantities. You can approve full or partial quantities for physical dock receiving.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {approveForm.items.map((it, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "12px",
                    background: "var(--color-slate-50)",
                    borderRadius: "6px",
                    border: "1px solid var(--color-slate-200)",
                  }}
                >
                  <div style={{ fontWeight: "700", fontSize: "14px", marginBottom: "4px" }}>
                    {it.productName} <span style={{ fontSize: "12px", color: "var(--color-slate-500)", fontWeight: "normal" }}>({it.sku})</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-slate-600)", marginBottom: "8px" }}>
                    Requested Quantity: <strong>{it.requestedQuantity}</strong>
                  </div>

                  <div className="form-grid-2">
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--color-emerald-700)" }}>Approved Qty</label>
                      <input
                        type="number"
                        min="0"
                        max={it.requestedQuantity}
                        value={it.approvedQuantity}
                        onChange={(e) => {
                          const app = Math.max(0, Math.min(it.requestedQuantity, Number(e.target.value) || 0));
                          const updated = [...approveForm.items];
                          updated[idx].approvedQuantity = app;
                          updated[idx].rejectedQuantity = it.requestedQuantity - app;
                          setApproveForm({ ...approveForm, items: updated });
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", color: "var(--color-rose-700)" }}>Rejected Qty</label>
                      <input
                        type="number"
                        min="0"
                        max={it.requestedQuantity}
                        value={it.rejectedQuantity}
                        disabled
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="form-field">
              <label>Approval Authorization Remarks</label>
              <textarea
                rows="2"
                value={approveForm.remarks}
                onChange={(e) => setApproveForm({ ...approveForm, remarks: e.target.value })}
                placeholder="e.g. Authorized customer return shipment via FedEx."
              />
            </div>
          </form>
        </Modal>
      )}

      {/* DOCK RECEIVING MODAL (Warehouse Manager) */}
      {selectedRma && (
        <Modal
          isOpen={isReceiveModalOpen}
          onClose={() => setIsReceiveModalOpen(false)}
          title={`Dock Check-in: ${selectedRma.returnNumber || selectedRma.rmaNumber}`}
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
                onClick={handleSubmitReceive}
                disabled={submitting}
              >
                {submitting ? "Logging Check-in..." : "Confirm Dock Receipt"}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmitReceive} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "10px", borderRadius: "6px", fontSize: "12.5px", color: "#1e40af" }}>
              <strong>Notice:</strong> Physical dock check-in logs arriving parcel delivery. Inventory balances will <strong>NOT</strong> increase until quality inspection is performed in the next step.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {receiveForm.items.map((it, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "10px",
                    background: "var(--color-slate-50)",
                    borderRadius: "6px",
                    border: "1px solid var(--color-slate-200)",
                  }}
                >
                  <div style={{ fontWeight: "700", fontSize: "13px" }}>{it.productName}</div>
                  <div style={{ fontSize: "12px", color: "var(--color-slate-500)", marginBottom: "6px" }}>
                    Approved: {it.approvedQuantity} &bull; Already Received: {it.alreadyReceived} &bull; <strong>Remaining: {it.remainingToReceive}</strong>
                  </div>

                  <div className="form-field">
                    <label style={{ fontSize: "11px" }}>Arrived at Dock (Units) *</label>
                    <input
                      type="number"
                      min="0"
                      max={it.remainingToReceive}
                      value={it.receivedQuantity}
                      onChange={(e) => {
                        const updated = [...receiveForm.items];
                        updated[idx].receivedQuantity = Math.max(0, Math.min(it.remainingToReceive, Number(e.target.value) || 0));
                        setReceiveForm({ ...receiveForm, items: updated });
                      }}
                      required
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="form-field">
              <label>Carrier Tracking / Dock Intake Notes</label>
              <textarea
                rows="2"
                value={receiveForm.dockRemarks}
                onChange={(e) => setReceiveForm({ ...receiveForm, dockRemarks: e.target.value })}
                placeholder="e.g. Tracking #9910283, outer carton in good condition."
              />
            </div>
          </form>
        </Modal>
      )}

      {/* 4-TIER INSPECTION MODAL (Warehouse Manager) */}
      {selectedRma && (
        <Modal
          isOpen={isInspectModalOpen}
          onClose={() => setIsInspectModalOpen(false)}
          title={`4-Tier Quality Inspection: ${selectedRma.returnNumber || selectedRma.rmaNumber}`}
          footer={
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsInspectModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmitInspect}
                disabled={submitting}
              >
                {submitting ? "Updating Inventories..." : "Complete Inspection & Update Stocks"}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmitInspect} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "var(--color-slate-600)" }}>
              Categorize received items. Clean stock updates sellable inventory; damaged and repair stock are isolated; rejected items are discarded with audit logs.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {inspectForm.items.map((it, idx) => {
                const allocated =
                  Number(it.goodQuantity || 0) +
                  Number(it.damagedQuantity || 0) +
                  Number(it.repairQuantity || 0) +
                  Number(it.rejectedQuantity || 0);

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
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <div style={{ fontWeight: "700", fontSize: "14px" }}>{it.productName}</div>
                      <span className={`badge ${allocated === it.remainingToInspect ? "badge-active" : "badge-warning"}`}>
                        Allocated: {allocated} / {it.remainingToInspect}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px" }}>
                      <div>
                        <label style={{ fontSize: "10.5px", color: "#16a34a", fontWeight: "700" }}>1. Good (Restock)</label>
                        <input
                          type="number"
                          min="0"
                          value={it.goodQuantity}
                          onChange={(e) => {
                            const updated = [...inspectForm.items];
                            updated[idx].goodQuantity = Math.max(0, Number(e.target.value) || 0);
                            setInspectForm({ ...inspectForm, items: updated });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "10.5px", color: "#dc2626", fontWeight: "700" }}>2. Damaged (Quar.)</label>
                        <input
                          type="number"
                          min="0"
                          value={it.damagedQuantity}
                          onChange={(e) => {
                            const updated = [...inspectForm.items];
                            updated[idx].damagedQuantity = Math.max(0, Number(e.target.value) || 0);
                            setInspectForm({ ...inspectForm, items: updated });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "10.5px", color: "#d97706", fontWeight: "700" }}>3. Repair Bay</label>
                        <input
                          type="number"
                          min="0"
                          value={it.repairQuantity}
                          onChange={(e) => {
                            const updated = [...inspectForm.items];
                            updated[idx].repairQuantity = Math.max(0, Number(e.target.value) || 0);
                            setInspectForm({ ...inspectForm, items: updated });
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: "10.5px", color: "#64748b", fontWeight: "700" }}>4. Rejected (Scrap)</label>
                        <input
                          type="number"
                          min="0"
                          value={it.rejectedQuantity}
                          onChange={(e) => {
                            const updated = [...inspectForm.items];
                            updated[idx].rejectedQuantity = Math.max(0, Number(e.target.value) || 0);
                            setInspectForm({ ...inspectForm, items: updated });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="form-field">
              <label>Quality Inspection Notes</label>
              <textarea
                rows="2"
                value={inspectForm.inspectionRemarks}
                onChange={(e) => setInspectForm({ ...inspectForm, inspectionRemarks: e.target.value })}
                placeholder="e.g. Units tested with power diagnostics; cosmetic scratches isolated to repair bay."
              />
            </div>
          </form>
        </Modal>
      )}

      {/* RESOLVE RMA MODAL (Sales Manager) */}
      {selectedRma && (
        <Modal
          isOpen={isResolveModalOpen}
          onClose={() => setIsResolveModalOpen(false)}
          title={`Settle RMA Case: ${selectedRma.returnNumber || selectedRma.rmaNumber}`}
          footer={
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsResolveModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleSubmitResolve}
                disabled={submitting}
              >
                {submitting ? "Resolving..." : "Finalize Settlement"}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmitResolve} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <label style={{ fontWeight: "700" }}>Choose Commercial Settlement Method *</label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div
                onClick={() => setResolveForm({ ...resolveForm, resolutionType: "REFUND" })}
                style={{
                  border: resolveForm.resolutionType === "REFUND" ? "2px solid var(--color-primary-600)" : "1px solid var(--color-slate-200)",
                  borderRadius: "8px",
                  padding: "12px",
                  cursor: "pointer",
                  background: resolveForm.resolutionType === "REFUND" ? "var(--color-primary-50)" : "#fff",
                }}
              >
                <div style={{ fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                  <DollarSign size={16} /> Credit Note (Refund)
                </div>
                <p style={{ fontSize: "12px", color: "var(--color-slate-600)", marginTop: "4px" }}>
                  Issues an official Credit Note to customer balance.
                </p>
              </div>

              <div
                onClick={() => setResolveForm({ ...resolveForm, resolutionType: "REPLACEMENT" })}
                style={{
                  border: resolveForm.resolutionType === "REPLACEMENT" ? "2px solid var(--color-primary-600)" : "1px solid var(--color-slate-200)",
                  borderRadius: "8px",
                  padding: "12px",
                  cursor: "pointer",
                  background: resolveForm.resolutionType === "REPLACEMENT" ? "var(--color-primary-50)" : "#fff",
                }}
              >
                <div style={{ fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                  <PackageCheck size={16} /> Warranty Replacement
                </div>
                <p style={{ fontSize: "12px", color: "var(--color-slate-600)", marginTop: "4px" }}>
                  Generates a $0 replacement Sales Order for confirmed good items.
                </p>
              </div>
            </div>

            {resolveForm.resolutionType === "REFUND" && (
              <div className="form-field">
                <label>Refund Amount ($) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={resolveForm.refundAmount}
                  onChange={(e) => setResolveForm({ ...resolveForm, refundAmount: e.target.value })}
                  required
                />
              </div>
            )}

            <div className="form-field">
              <label>Resolution Settlement Notes</label>
              <textarea
                rows="2"
                value={resolveForm.remarks}
                onChange={(e) => setResolveForm({ ...resolveForm, remarks: e.target.value })}
                placeholder="e.g. Customer agreed to 100% store credit."
              />
            </div>
          </form>
        </Modal>
      )}

      {/* DETAIL MODAL */}
      {selectedRma && (
        <Modal
          isOpen={isDetailModalOpen}
          onClose={() => setIsDetailModalOpen(false)}
          title={`Return Case: ${selectedRma.returnNumber || selectedRma.rmaNumber}`}
          footer={
            <button type="button" className="btn-secondary" onClick={() => setIsDetailModalOpen(false)}>
              Close
            </button>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="form-grid-2" style={{ background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px" }}>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Party</div>
                <div style={{ fontWeight: "700" }}>{selectedRma.customer?.customerName || selectedRma.vendor?.vendorName || "Entity"}</div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Status: <strong>{selectedRma.status}</strong></div>
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Designated Facility</div>
                <div style={{ fontWeight: "700" }}>{selectedRma.warehouse?.warehouseName || selectedRma.warehouse?.name || "Facility"}</div>
                {selectedRma.creditNoteNumber && <div style={{ fontSize: "12px", color: "var(--color-emerald-700)" }}>Credit Note: {selectedRma.creditNoteNumber}</div>}
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "8px" }}>Items Quality Disposition</h4>
              <table style={{ width: "100%", fontSize: "12.5px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-slate-200)", textAlign: "left", color: "var(--color-slate-600)" }}>
                    <th style={{ padding: "6px" }}>Product</th>
                    <th style={{ padding: "6px" }}>Req</th>
                    <th style={{ padding: "6px" }}>Appr</th>
                    <th style={{ padding: "6px" }}>Recv</th>
                    <th style={{ padding: "6px", color: "#16a34a" }}>Good</th>
                    <th style={{ padding: "6px", color: "#dc2626" }}>Dmg</th>
                    <th style={{ padding: "6px", color: "#d97706" }}>Rep</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedRma.items || []).map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                      <td style={{ padding: "6px", fontWeight: "600" }}>{it.product?.productName || "Product"}</td>
                      <td style={{ padding: "6px" }}>{it.requestedQuantity || it.quantity}</td>
                      <td style={{ padding: "6px" }}>{it.approvedQuantity || 0}</td>
                      <td style={{ padding: "6px" }}>{it.receivedQuantity || 0}</td>
                      <td style={{ padding: "6px", color: "#16a34a", fontWeight: "700" }}>{it.goodQuantity || 0}</td>
                      <td style={{ padding: "6px", color: "#dc2626" }}>{it.damagedQuantity || 0}</td>
                      <td style={{ padding: "6px", color: "#d97706" }}>{it.repairQuantity || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedRma.remarks && (
              <div style={{ fontSize: "12px", color: "var(--color-slate-600)", background: "#fff", padding: "8px", border: "1px solid #e2e8f0", borderRadius: "4px" }}>
                <strong>Remarks:</strong> {selectedRma.remarks}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ReturnsPage;

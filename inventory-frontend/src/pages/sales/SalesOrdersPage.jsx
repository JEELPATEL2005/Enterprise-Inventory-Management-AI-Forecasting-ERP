import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, ShoppingCart, CheckCircle, PackageCheck, AlertCircle, RefreshCw, FileText, Ban, Truck, Trash2, UserPlus } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import axiosInstance from "../../utils/axiosConfig";

export const SalesOrdersPage = () => {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  // New Order Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    customer: "",
    warehouse: "",
    deliveryDate: "",
    taxAmount: 0,
    discountAmount: 0,
    remarks: "",
    items: [{ product: "", quantity: 1, unitPrice: 0 }],
  });

  // Inline Quick-Add Customer State
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [customerFormData, setCustomerFormData] = useState({
    customerName: "",
    phone: "",
    email: "",
    address: "",
  });
  const [savingCustomer, setSavingCustomer] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [soRes, custRes, whRes, prodRes] = await Promise.all([
        axiosInstance.get("/api/sales-orders"),
        axiosInstance.get("/api/customers"),
        axiosInstance.get("/api/warehouses"),
        axiosInstance.get("/api/products"),
      ]);

      const soData = soRes.data?.data || soRes.data || [];
      const custList = custRes.data?.data || custRes.data || [];
      const whList = whRes.data?.data || whRes.data || [];
      const prodList = prodRes.data?.data || prodRes.data || [];

      setOrders(Array.isArray(soData) ? soData : []);
      setCustomers(Array.isArray(custList) ? custList : []);
      setWarehouses(Array.isArray(whList) ? whList : []);
      setProducts(Array.isArray(prodList) ? prodList : []);

      if (custList.length > 0 && !formData.customer) {
        setFormData((prev) => ({ ...prev, customer: custList[0]._id }));
      }
      if (whList.length > 0 && !formData.warehouse) {
        setFormData((prev) => ({ ...prev, warehouse: whList[0]._id }));
      }
      if (prodList.length > 0 && formData.items.length === 1 && !formData.items[0].product) {
        setFormData((prev) => ({
          ...prev,
          items: [{ product: prodList[0]._id, quantity: 1, unitPrice: prodList[0].unitPrice || 0 }],
        }));
      }
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load sales orders.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddItemRow = () => {
    const defaultProd = products[0];
    setFormData((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          product: defaultProd ? defaultProd._id : "",
          quantity: 1,
          unitPrice: defaultProd?.unitPrice || 0,
        },
      ],
    }));
  };

  const handleRemoveItemRow = (index) => {
    if (formData.items.length <= 1) return;
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index),
    }));
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...formData.items];
    updated[index][field] = value;
    if (field === "product") {
      const selected = products.find((p) => p._id === value);
      if (selected) {
        updated[index].unitPrice = selected.unitPrice || 0;
      }
    }
    setFormData((prev) => ({ ...prev, items: updated }));
  };

  const calculateSubtotal = () => {
    return formData.items.reduce((acc, it) => acc + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  };

  const calculateTotal = () => {
    const sub = calculateSubtotal();
    const tax = Number(formData.taxAmount) || 0;
    const disc = Number(formData.discountAmount) || 0;
    return Math.max(0, sub + tax - disc);
  };

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    if (!customerFormData.customerName.trim() || !customerFormData.phone.trim()) {
      setToast({ type: "error", message: "Customer name and phone number are required." });
      return;
    }

    try {
      setSavingCustomer(true);
      const res = await axiosInstance.post("/api/customers", customerFormData);
      const newCust = res.data?.data || res.data;

      setCustomers((prev) => [newCust, ...prev]);
      setFormData((prev) => ({ ...prev, customer: newCust._id }));
      setIsCustomerModalOpen(false);
      setCustomerFormData({ customerName: "", phone: "", email: "", address: "" });
      setToast({ type: "success", message: `Customer "${newCust.customerName}" created and selected!` });
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to create customer.",
      });
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    if (!formData.customer || !formData.warehouse) {
      setToast({ type: "error", message: "Customer and fulfillment warehouse are required." });
      return;
    }

    if (!formData.items || formData.items.length === 0) {
      setToast({ type: "error", message: "At least one item must be added." });
      return;
    }

    for (const it of formData.items) {
      if (!it.product) {
        setToast({ type: "error", message: "Please select a product for all item rows." });
        return;
      }
      if (Number(it.quantity) <= 0) {
        setToast({ type: "error", message: "Quantity for all items must be greater than zero." });
        return;
      }
    }

    if (formData.deliveryDate) {
      const selectedDate = new Date(formData.deliveryDate);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      if (selectedDate < todayStart) {
        setToast({
          type: "error",
          message: "Expected delivery date cannot be in the past. Please select today or a future date.",
        });
        return;
      }
    }

    try {
      setSubmitting(true);
      const payload = {
        customer: formData.customer,
        warehouse: formData.warehouse,
        deliveryDate: formData.deliveryDate || undefined,
        items: formData.items.map((it) => ({
          product: it.product,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
        })),
        taxAmount: Number(formData.taxAmount) || 0,
        discountAmount: Number(formData.discountAmount) || 0,
        remarks: formData.remarks,
      };

      await axiosInstance.post("/api/sales-orders", payload);
      setToast({ type: "success", message: "Sales order created successfully." });
      setIsModalOpen(false);
      setFormData({
        customer: customers[0]?._id || "",
        warehouse: warehouses[0]?._id || "",
        deliveryDate: "",
        taxAmount: 0,
        discountAmount: 0,
        remarks: "",
        items: [{ product: products[0]?._id || "", quantity: 1, unitPrice: products[0]?.unitPrice || 0 }],
      });
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to create sales order.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReserve = async (id) => {
    try {
      await axiosInstance.put(`/api/sales-orders/${id}/reserve`);
      setToast({ type: "success", message: "Stock reserved for sales order." });
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Insufficient warehouse stock to reserve.",
      });
    }
  };

  const handleFulfill = async (id) => {
    if (!window.confirm("Fulfill this order? This will deduct reserved warehouse stock and create STOCK_OUT.")) {
      return;
    }
    try {
      await axiosInstance.put(`/api/sales-orders/${id}/fulfill`);
      setToast({ type: "success", message: "Order fulfilled and stock deducted!" });
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to fulfill sales order.",
      });
    }
  };

  const handleInvoice = async (id) => {
    try {
      const res = await axiosInstance.post(`/api/sales-orders/${id}/invoice`);
      const invData = res.data?.data;
      const invNum = invData?.invoiceNumber || "INV";
      const isExisting = res.data?.alreadyExisted;
      setToast({
        type: "success",
        message: isExisting
          ? `Invoice ${invNum} is already generated for this order. View in Invoices.`
          : `Invoice ${invNum} generated successfully! Check in Invoices tab.`,
      });
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to generate invoice.",
      });
    }
  };

  const handleCancel = async (id) => {
    if (!window.confirm("Are you sure you want to cancel this sales order?")) return;
    try {
      await axiosInstance.put(`/api/sales-orders/${id}/cancel`);
      setToast({ type: "success", message: "Order cancelled." });
      fetchData();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to cancel order.",
      });
    }
  };

  const columns = [
    {
      header: "Order Number",
      accessor: "salesOrderNumber",
      render: (val, row) => (
        <span style={{ fontWeight: "700", color: "var(--color-primary-700)" }}>
          {val || `SO-${String(row._id).slice(-6).toUpperCase()}`}
        </span>
      ),
    },
    {
      header: "Customer",
      accessor: "customer",
      render: (val) => (
        <span style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>
          {val?.customerName || val?.name || "Client"}
        </span>
      ),
    },
    {
      header: "Fulfillment Warehouse",
      accessor: "warehouse",
      render: (val) => val?.name || val?.warehouseName || "Warehouse",
    },
    {
      header: "Items",
      accessor: "items",
      render: (items) => (
        <div>
          {items?.map((it, idx) => (
            <div key={idx} style={{ fontSize: "13px" }}>
              {it.product?.productName || "Product"} &times; {it.quantity}
            </div>
          ))}
        </div>
      ),
    },
    {
      header: "Contract Amount",
      accessor: "totalAmount",
      render: (val) => <span style={{ fontWeight: "700" }}>${val?.toLocaleString() || 0}</span>,
    },
    {
      header: "Status",
      accessor: "status",
      render: (val) => {
        let badgeClass = "badge-pending";
        if (val === "DELIVERED" || val === "SHIPPED") badgeClass = "badge-active";
        if (val === "CONFIRMED" || val === "PROCESSING" || val === "RESERVED" || val === "FULFILLED") badgeClass = "badge-info";
        if (val === "CANCELLED") badgeClass = "badge-inactive";
        return <span className={`badge ${badgeClass}`}>{val}</span>;
      },
    },
    {
      header: "Invoice Ref",
      accessor: "invoice",
      render: (inv) => {
        if (inv?.invoiceNumber) {
          return (
            <Link
              to="/sales/invoices"
              className="badge badge-active"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px" }}
              title="Click to view invoice details"
            >
              <FileText size={11} />
              <span>{inv.invoiceNumber}</span>
            </Link>
          );
        }
        return (
          <span className="badge badge-pending" style={{ opacity: 0.7 }}>
            Not Invoiced
          </span>
        );
      },
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (id, row) => (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {row.status === "PENDING" && (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: "4px 8px", fontSize: "11px" }}
              onClick={() => handleReserve(id)}
            >
              Reserve Stock
            </button>
          )}
          {(row.status === "CONFIRMED" || row.status === "PROCESSING" || row.status === "RESERVED") && (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: "4px 8px", fontSize: "11px" }}
              onClick={() => handleFulfill(id)}
            >
              Fulfill / Ship
            </button>
          )}
          {row.status !== "CANCELLED" && (
            row.invoice?.invoiceNumber ? (
              <Link
                to="/sales/invoices"
                className="btn-secondary"
                style={{
                  padding: "4px 8px",
                  fontSize: "11px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  color: "var(--color-primary-700)",
                  textDecoration: "none",
                  fontWeight: "600",
                }}
                title="View generated invoice in billing portal"
              >
                <FileText size={12} /> View {row.invoice.invoiceNumber}
              </Link>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "4px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                onClick={() => handleInvoice(id)}
              >
                <FileText size={12} /> Generate Invoice
              </button>
            )
          )}
          {(row.status === "FULFILLED" || row.status === "SHIPPED") && (
            <Link
              to="/delivery/assigned"
              className="btn-secondary"
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                color: "var(--color-emerald-700)",
                textDecoration: "none",
              }}
              title="Assign delivery route and dispatcher"
            >
              <Truck size={12} /> Dispatch
            </Link>
          )}
          {row.status === "PENDING" && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: "4px 8px", fontSize: "11px", color: "var(--color-rose-600)" }}
              onClick={() => handleCancel(id)}
            >
              <Ban size={12} /> Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  const totalValue = orders.reduce((acc, o) => acc + (o.totalAmount || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700" }}>Sales Orders & Fulfillment</h1>
          <p style={{ color: "var(--color-slate-500)", marginTop: "4px", fontSize: "14px" }}>
            Track client contracts, multi-item line reservations, and warehouse fulfillment workflows.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" className="btn-secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
          <button type="button" className="btn-primary" onClick={() => setIsModalOpen(true)}>
            <Plus size={16} /> New Sales Order
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Total Orders</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>
              <ShoppingCart size={20} />
            </div>
          </div>
          <div className="stat-value">{orders.length}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Recorded client orders</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Pending Reservation / Processing</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-warning-50)", color: "var(--color-warning-700)" }}>
              <PackageCheck size={20} />
            </div>
          </div>
          <div className="stat-value">
            {orders.filter((o) => ["PENDING", "CONFIRMED", "PROCESSING"].includes(o.status)).length}
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Active fulfillment pipeline</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Total Contract Value</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-success-50)", color: "var(--color-success-700)" }}>
              <CheckCircle size={20} />
            </div>
          </div>
          <div className="stat-value">${totalValue.toLocaleString()}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Across all active sales</span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--color-slate-500)" }}>
          Loading sales orders...
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <ShoppingCart size={48} style={{ margin: "0 auto", opacity: 0.3 }} />
          <h3>No sales orders created</h3>
          <p>Click 'New Sales Order' to register a customer order and reserve stock from designated warehouses.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={orders}
          searchPlaceholder="Search order number or customer..."
        />
      )}

      {/* Main Create Sales Order Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Create New Sales Order"
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
              onClick={handleCreateOrder}
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Save Sales Order"}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateOrder} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-grid-2">
            <div className="form-field">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label style={{ margin: 0 }}>Customer / Client *</label>
                <button
                  type="button"
                  onClick={() => setIsCustomerModalOpen(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-primary-600)",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontWeight: "600",
                    padding: 0,
                  }}
                >
                  <UserPlus size={13} /> + New Customer
                </button>
              </div>
              <select
                value={formData.customer}
                onChange={(e) => setFormData({ ...formData, customer: e.target.value })}
                required
              >
                <option value="">Select customer...</option>
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.customerName || c.name} {c.phone ? `(${c.phone})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>Fulfillment Warehouse *</label>
              <select
                value={formData.warehouse}
                onChange={(e) => setFormData({ ...formData, warehouse: e.target.value })}
                required
              >
                <option value="">Select warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w._id} value={w._id}>
                    {w.name || w.warehouseName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dynamic Item Lines Table */}
          <div style={{ borderTop: "1px solid var(--color-slate-200)", paddingTop: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label style={{ fontWeight: "700", fontSize: "14px", margin: 0 }}>Order Line Items</label>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "4px 8px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                onClick={handleAddItemRow}
              >
                <Plus size={13} /> Add Line Item
              </button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "var(--color-slate-50)", textAlign: "left" }}>
                  <th style={{ padding: "6px" }}>Product *</th>
                  <th style={{ padding: "6px", width: "90px" }}>Qty *</th>
                  <th style={{ padding: "6px", width: "110px" }}>Unit Price ($) *</th>
                  <th style={{ padding: "6px", width: "90px", textAlign: "right" }}>Total</th>
                  <th style={{ padding: "6px", width: "40px" }}></th>
                </tr>
              </thead>
              <tbody>
                {formData.items.map((row, idx) => {
                  const lineTotal = (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0);
                  return (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                      <td style={{ padding: "6px" }}>
                        <select
                          value={row.product}
                          onChange={(e) => handleItemChange(idx, "product", e.target.value)}
                          style={{ width: "100%", padding: "6px", fontSize: "12px" }}
                          required
                        >
                          <option value="">Select product...</option>
                          {products.map((p) => (
                            <option key={p._id} value={p._id}>
                              {p.productName} ({p.sku}) - Base: ${p.unitPrice || 0}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "6px" }}>
                        <input
                          type="number"
                          min="1"
                          required
                          value={row.quantity}
                          onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                          style={{ width: "100%", padding: "6px", fontSize: "12px" }}
                        />
                      </td>
                      <td style={{ padding: "6px" }}>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={row.unitPrice}
                          onChange={(e) => handleItemChange(idx, "unitPrice", e.target.value)}
                          style={{ width: "100%", padding: "6px", fontSize: "12px" }}
                        />
                      </td>
                      <td style={{ padding: "6px", textAlign: "right", fontWeight: "600" }}>
                        ${lineTotal.toLocaleString()}
                      </td>
                      <td style={{ padding: "6px", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => handleRemoveItemRow(idx)}
                          disabled={formData.items.length <= 1}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: formData.items.length > 1 ? "pointer" : "not-allowed",
                            color: formData.items.length > 1 ? "var(--color-rose-600)" : "var(--color-slate-300)",
                            padding: "2px",
                          }}
                          title="Remove item"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Subtotal, Tax, Discount & Total Calculation */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", borderTop: "1px solid var(--color-slate-200)", paddingTop: "12px" }}>
            <div className="form-field">
              <label>Tax Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.taxAmount}
                onChange={(e) => setFormData({ ...formData, taxAmount: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Discount Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.discountAmount}
                onChange={(e) => setFormData({ ...formData, discountAmount: e.target.value })}
              />
            </div>
          </div>

          <div style={{ background: "var(--color-slate-50)", padding: "10px 14px", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>
                Subtotal: ${calculateSubtotal().toLocaleString()}
              </span>
            </div>
            <div>
              <span style={{ fontSize: "15px", fontWeight: "800", color: "var(--color-primary-700)" }}>
                Order Total: ${calculateTotal().toLocaleString()}
              </span>
            </div>
          </div>

          <div className="form-field">
            <label>Expected Delivery Date</label>
            <input
              type="date"
              min={new Date().toISOString().split("T")[0]}
              value={formData.deliveryDate || ""}
              onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
            />
          </div>

          <div className="form-field">
            <label>Order Notes / Terms</label>
            <textarea
              rows="2"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              placeholder="e.g. Standard delivery requested."
            />
          </div>
        </form>
      </Modal>

      {/* Inline Quick-Add Customer Modal */}
      <Modal
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        title="Add New Customer"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsCustomerModalOpen(false)}
              disabled={savingCustomer}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreateCustomer}
              disabled={savingCustomer}
            >
              {savingCustomer ? "Saving..." : "Create & Select"}
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateCustomer} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div className="form-field">
            <label>Customer / Company Name *</label>
            <input
              type="text"
              required
              placeholder="e.g. Metro Retailers Ltd"
              value={customerFormData.customerName}
              onChange={(e) => setCustomerFormData({ ...customerFormData, customerName: e.target.value })}
            />
          </div>
          <div className="form-grid-2">
            <div className="form-field">
              <label>Phone Number *</label>
              <input
                type="text"
                required
                placeholder="e.g. 9876543210"
                value={customerFormData.phone}
                onChange={(e) => setCustomerFormData({ ...customerFormData, phone: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="client@example.com"
                value={customerFormData.email}
                onChange={(e) => setCustomerFormData({ ...customerFormData, email: e.target.value })}
              />
            </div>
          </div>
          <div className="form-field">
            <label>Delivery Address</label>
            <textarea
              rows="2"
              placeholder="Full shipping / billing address"
              value={customerFormData.address}
              onChange={(e) => setCustomerFormData({ ...customerFormData, address: e.target.value })}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default SalesOrdersPage;

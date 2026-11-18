import React, { useState, useEffect } from "react";
import { Receipt, DollarSign, CheckCircle, RefreshCw, AlertCircle, CreditCard, Eye, Printer, PlusCircle, Calendar } from "lucide-react";
import DataTable from "../../components/common/DataTable";
import Modal from "../../components/common/Modal";
import Toast from "../../components/common/Toast";
import axiosInstance from "../../utils/axiosConfig";

export const InvoicesPage = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Payment Modal State
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [transactionRef, setTransactionRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // View / Print Invoice Modal State
  const [viewInvoice, setViewInvoice] = useState(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const res = await axiosInstance.get("/api/invoices");
      const list = res.data?.data || res.data || [];
      setInvoices(Array.isArray(list) ? list : []);
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to load invoices.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const openPaymentModal = (inv) => {
    setSelectedInvoice(inv);
    const due = inv.balanceDue !== undefined ? inv.balanceDue : (inv.totalAmount - (inv.amountPaid || 0));
    setPaymentAmount(due > 0 ? due : inv.totalAmount);
    setPaymentMethod("BANK_TRANSFER");
    setTransactionRef("");
    setPaymentNotes("");
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setIsPaymentModalOpen(true);
  };

  const openViewModal = (inv) => {
    setViewInvoice(inv);
    setIsViewModalOpen(true);
  };

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    const amt = Number(paymentAmount);
    if (isNaN(amt) || amt <= 0) {
      setToast({ type: "error", message: "Please specify a valid payment amount greater than zero." });
      return;
    }

    if (paymentDate) {
      const pDate = new Date(paymentDate);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      if (pDate > todayEnd) {
        setToast({ type: "error", message: "Payment date cannot be in the future." });
        return;
      }
    }

    try {
      setSubmitting(true);
      await axiosInstance.put(`/api/invoices/${selectedInvoice._id}/payment`, {
        amount: amt,
        paymentMethod,
        transactionRef,
        notes: paymentNotes,
        paymentDate: paymentDate || undefined,
      });

      setToast({ type: "success", message: `Payment of $${amt.toLocaleString()} recorded successfully.` });
      setIsPaymentModalOpen(false);
      fetchInvoices();
    } catch (err) {
      setToast({
        type: "error",
        message: err.response?.data?.message || "Failed to record payment.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      header: "Invoice Reference",
      accessor: "invoiceNumber",
      render: (val, row) => (
        <span style={{ fontWeight: "700", color: "var(--color-primary-700)" }}>
          {val || `INV-${String(row._id).slice(-6).toUpperCase()}`}
        </span>
      ),
    },
    {
      header: "Sales Order",
      accessor: "salesOrder",
      render: (so) => <span style={{ fontWeight: "600" }}>{so?.salesOrderNumber || "SO Ref"}</span>,
    },
    {
      header: "Client Account",
      accessor: "customer",
      render: (cust, row) => {
        const client = cust || row.salesOrder?.customer;
        return (
          <span style={{ fontWeight: "600", color: "var(--color-slate-900)" }}>
            {client?.customerName || client?.name || "Client Account"}
          </span>
        );
      },
    },
    {
      header: "Billing Date",
      accessor: "invoiceDate",
      render: (val) => (val ? new Date(val).toLocaleDateString() : "-"),
    },
    {
      header: "Total / Due",
      accessor: "totalAmount",
      render: (val, row) => {
        const due = row.balanceDue !== undefined ? row.balanceDue : (val - (row.amountPaid || 0));
        return (
          <div>
            <div style={{ fontWeight: "700" }}>${val?.toLocaleString() || 0}</div>
            <div style={{ fontSize: "11px", color: due > 0 ? "var(--color-rose-600)" : "var(--color-emerald-600)" }}>
              {due > 0 ? `Due: $${due.toLocaleString()}` : "Fully Paid"}
            </div>
          </div>
        );
      },
    },
    {
      header: "Payment Status",
      accessor: "paymentStatus",
      render: (val) => {
        let badgeClass = "badge-pending";
        if (val === "PAID") badgeClass = "badge-active";
        if (val === "OVERDUE") badgeClass = "badge-inactive";
        if (val === "PARTIALLY_PAID") badgeClass = "badge-warning";
        return <span className={`badge ${badgeClass}`}>{val || "UNPAID"}</span>;
      },
    },
    {
      header: "Action",
      accessor: "_id",
      render: (id, row) => (
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
            onClick={() => openViewModal(row)}
            title="View invoice details and payment ledger"
          >
            <Eye size={13} /> View
          </button>
          {row.paymentStatus !== "PAID" && (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: "4px 8px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
              onClick={() => openPaymentModal(row)}
              title="Record customer payment or settlement"
            >
              <CreditCard size={13} /> Settle
            </button>
          )}
        </div>
      ),
    },
  ];

  const totalInvoiced = invoices.reduce((acc, inv) => acc + (inv.totalAmount || 0), 0);
  const totalCollected = invoices.reduce((acc, inv) => {
    if (inv.amountPaid !== undefined) return acc + inv.amountPaid;
    if (inv.paymentStatus === "PAID") return acc + (inv.totalAmount || 0);
    return acc;
  }, 0);
  const totalOutstanding = Math.max(0, totalInvoiced - totalCollected);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "700" }}>Invoices & Accounts Receivable</h1>
          <p style={{ color: "var(--color-slate-500)", marginTop: "4px", fontSize: "14px" }}>
            Commercial tax invoices, payment ledger reconciliation, partial settlements, and receivable aging.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={fetchInvoices} disabled={loading}>
          <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Total Invoiced Volume</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-primary-100)", color: "var(--color-primary-700)" }}>
              <Receipt size={20} />
            </div>
          </div>
          <div className="stat-value">${totalInvoiced.toLocaleString()}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>{invoices.length} invoices generated</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Collected Revenue</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-success-50)", color: "var(--color-success-700)" }}>
              <CheckCircle size={20} />
            </div>
          </div>
          <div className="stat-value">${totalCollected.toLocaleString()}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Settled & partial collections</span>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Outstanding Receivables</span>
            <div className="stat-icon-wrapper" style={{ background: "var(--color-warning-50)", color: "var(--color-warning-700)" }}>
              <DollarSign size={20} />
            </div>
          </div>
          <div className="stat-value">${totalOutstanding.toLocaleString()}</div>
          <span style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>Pending client balance</span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--color-slate-500)" }}>
          Loading invoice ledgers...
        </div>
      ) : invoices.length === 0 ? (
        <div className="empty-state">
          <Receipt size={48} style={{ margin: "0 auto", opacity: 0.3 }} />
          <h3>No invoices recorded</h3>
          <p>Generate invoices directly from Sales Orders upon order confirmation or fulfillment.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={invoices}
          searchPlaceholder="Search invoice number or sales order..."
        />
      )}

      {/* Settle / Record Payment Modal */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title={`Record Payment - ${selectedInvoice?.invoiceNumber || "Invoice"}`}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIsPaymentModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleRecordPayment}
              disabled={submitting}
            >
              {submitting ? "Recording..." : "Save Payment"}
            </button>
          </>
        }
      >
        <form onSubmit={handleRecordPayment} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", padding: "12px", background: "var(--color-slate-50)", borderRadius: "6px" }}>
            <div>
              <div style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Invoice Total</div>
              <div style={{ fontSize: "15px", fontWeight: "700" }}>${selectedInvoice?.totalAmount?.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Already Paid</div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "var(--color-emerald-600)" }}>${(selectedInvoice?.amountPaid || 0).toLocaleString()}</div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--color-slate-500)" }}>Balance Due</div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "var(--color-rose-600)" }}>
                ${(selectedInvoice?.balanceDue !== undefined ? selectedInvoice.balanceDue : (selectedInvoice?.totalAmount - (selectedInvoice?.amountPaid || 0))).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>Payment Amount ($) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>Payment Method *</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                required
              >
                <option value="BANK_TRANSFER">Bank Transfer (Wire / ACH)</option>
                <option value="CARD">Credit / Debit Card</option>
                <option value="CASH">Cash</option>
                <option value="UPI">UPI / Digital Wallet</option>
                <option value="CREDIT">Corporate Credit</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>Payment Date *</label>
              <input
                type="date"
                max={new Date().toISOString().split("T")[0]}
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>Transaction / UTR Reference (Optional)</label>
              <input
                type="text"
                placeholder="e.g. TXN-8923482 or Cheque #1029"
                value={transactionRef}
                onChange={(e) => setTransactionRef(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <label>Notes / Remarks</label>
            <input
              type="text"
              placeholder="e.g. Advance installment received via bank transfer."
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
            />
          </div>
        </form>
      </Modal>

      {/* View / Print Invoice Modal */}
      {viewInvoice && (
        <Modal
          isOpen={isViewModalOpen}
          onClose={() => setIsViewModalOpen(false)}
          title={`Commercial Invoice - ${viewInvoice.invoiceNumber}`}
          footer={
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                onClick={() => window.print()}
              >
                <Printer size={14} /> Print Invoice
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setIsViewModalOpen(false)}
              >
                Close
              </button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "4px" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--color-slate-200)", paddingBottom: "16px" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: "800", color: "var(--color-primary-700)", margin: 0 }}>
                  INVENTORY ERP CORP
                </h2>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)", marginTop: "4px" }}>
                  Logistics & Distribution Headquarters
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "18px", fontWeight: "700" }}>{viewInvoice.invoiceNumber}</div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>
                  Date: {new Date(viewInvoice.invoiceDate || viewInvoice.createdAt).toLocaleDateString()}
                </div>
                <div style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>
                  Order Ref: <strong>{viewInvoice.salesOrder?.salesOrderNumber || "Direct"}</strong>
                </div>
              </div>
            </div>

            {/* Billed To */}
            <div style={{ background: "var(--color-slate-50)", padding: "12px", borderRadius: "6px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: "var(--color-slate-500)" }}>
                Billed To
              </div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "var(--color-slate-900)", marginTop: "2px" }}>
                {viewInvoice.customer?.customerName || viewInvoice.salesOrder?.customer?.customerName || "Customer"}
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-slate-600)" }}>
                Phone: {viewInvoice.customer?.phone || viewInvoice.salesOrder?.customer?.phone || "N/A"} | Email: {viewInvoice.customer?.email || viewInvoice.salesOrder?.customer?.email || "N/A"}
              </div>
            </div>

            {/* Itemized Table */}
            <div>
              <div style={{ fontSize: "13px", fontWeight: "700", marginBottom: "8px" }}>Itemized Bill of Goods</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ background: "var(--color-slate-100)", textAlign: "left" }}>
                    <th style={{ padding: "8px" }}>Item & SKU</th>
                    <th style={{ padding: "8px", textAlign: "right" }}>Qty</th>
                    <th style={{ padding: "8px", textAlign: "right" }}>Unit Price</th>
                    <th style={{ padding: "8px", textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewInvoice.items || []).map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-slate-200)" }}>
                      <td style={{ padding: "8px" }}>
                        <strong>{it.product?.productName || "Product"}</strong> {it.product?.sku && `(${it.product.sku})`}
                      </td>
                      <td style={{ padding: "8px", textAlign: "right" }}>{it.quantity}</td>
                      <td style={{ padding: "8px", textAlign: "right" }}>${it.unitPrice?.toLocaleString()}</td>
                      <td style={{ padding: "8px", textAlign: "right", fontWeight: "600" }}>${it.totalPrice?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ width: "260px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--color-slate-600)" }}>Subtotal:</span>
                  <span>${viewInvoice.subtotal?.toLocaleString() || 0}</span>
                </div>
                {viewInvoice.taxAmount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-slate-600)" }}>Taxes:</span>
                    <span>+${viewInvoice.taxAmount.toLocaleString()}</span>
                  </div>
                )}
                {viewInvoice.discountAmount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-slate-600)" }}>Discount:</span>
                    <span>-${viewInvoice.discountAmount.toLocaleString()}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid var(--color-slate-300)", paddingTop: "6px", fontWeight: "800", fontSize: "15px" }}>
                  <span>Grand Total:</span>
                  <span>${viewInvoice.totalAmount?.toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--color-emerald-700)", fontWeight: "600" }}>
                  <span>Amount Paid:</span>
                  <span>${(viewInvoice.amountPaid || 0).toLocaleString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--color-rose-700)", fontWeight: "700" }}>
                  <span>Balance Due:</span>
                  <span>${(viewInvoice.balanceDue !== undefined ? viewInvoice.balanceDue : (viewInvoice.totalAmount - (viewInvoice.amountPaid || 0))).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Payment History Ledger */}
            {viewInvoice.payments && viewInvoice.payments.length > 0 && (
              <div style={{ marginTop: "12px", borderTop: "1px dashed var(--color-slate-300)", paddingTop: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: "700", marginBottom: "8px", textTransform: "uppercase", color: "var(--color-slate-600)" }}>
                  Payment Receipts & Reconciliation Ledger
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ background: "var(--color-slate-50)", textAlign: "left" }}>
                      <th style={{ padding: "6px" }}>Date</th>
                      <th style={{ padding: "6px" }}>Method</th>
                      <th style={{ padding: "6px" }}>Reference</th>
                      <th style={{ padding: "6px" }}>Notes</th>
                      <th style={{ padding: "6px", textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewInvoice.payments.map((p, pIdx) => (
                      <tr key={pIdx} style={{ borderBottom: "1px solid var(--color-slate-100)" }}>
                        <td style={{ padding: "6px" }}>{new Date(p.paymentDate || p.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: "6px" }}>{p.paymentMethod}</td>
                        <td style={{ padding: "6px" }}>{p.transactionRef || "—"}</td>
                        <td style={{ padding: "6px" }}>{p.notes || "—"}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontWeight: "700", color: "var(--color-emerald-700)" }}>
                          ${p.amount?.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default InvoicesPage;

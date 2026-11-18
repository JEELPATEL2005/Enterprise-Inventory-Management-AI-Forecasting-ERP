import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Clock, Building2, Warehouse, FileText, AlertCircle, ShoppingCart } from "lucide-react";
import axios from "axios";

export const VendorResponsePage = () => {
  const { token } = useParams();
  const [poData, setPoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState(null);

  const apiBase = import.meta.env.VITE_API_URL || "http://localhost:3000";

  useEffect(() => {
    const fetchPoSummary = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${apiBase}/api/purchase-orders/vendor-response/${token}`);
        if (res.data?.success) {
          setPoData(res.data.data);
          if (res.data.data.vendorAcceptanceStatus !== "PENDING") {
            setSubmittedStatus(res.data.data.vendorAcceptanceStatus);
          }
        }
      } catch (err) {
        setError(err.response?.data?.message || "This purchase order link is invalid or expired.");
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      fetchPoSummary();
    }
  }, [token, apiBase]);

  const handleAction = async (actionType) => {
    if (actionType === "REJECTED" && !remarks.trim()) {
      alert("Please provide remarks explaining why the order cannot be fulfilled.");
      return;
    }

    if (!window.confirm(`Are you sure you want to mark this Purchase Order as ${actionType}?`)) {
      return;
    }

    try {
      setSubmitting(true);
      const res = await axios.post(`${apiBase}/api/purchase-orders/vendor-response/${token}`, {
        response: actionType,
        remarks: remarks.trim(),
      });

      if (res.data?.success) {
        setSubmittedStatus(actionType);
      }
    } catch (err) {
      alert(err.response?.data?.message || "Failed to submit response.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", color: "#64748b" }}>
          <Clock size={32} className="animate-spin" style={{ margin: "0 auto 12px" }} />
          <p>Verifying secure vendor response token...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: "20px" }}>
        <div style={{ maxWidth: "480px", width: "100%", background: "#ffffff", padding: "32px", borderRadius: "10px", boxShadow: "0 4px 12px rgba(0,0,0,0.06)", textAlign: "center" }}>
          <AlertCircle size={48} color="#ef4444" style={{ margin: "0 auto 16px" }} />
          <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#0f172a", marginBottom: "8px" }}>Link Inactive</h2>
          <p style={{ color: "#64748b", fontSize: "14px", lineHeight: "1.5" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "40px 16px", color: "#0f172a", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        {/* Header Branding */}
        <div style={{ background: "#0f172a", color: "#ffffff", padding: "24px 32px", borderRadius: "10px 10px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "700" }}>Supply Chain ERP</h1>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#94a3b8" }}>Supplier Order Response Gateway</p>
          </div>
          <span style={{ background: "rgba(255,255,255,0.15)", padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: "600" }}>
            PO: {poData?.poNumber}
          </span>
        </div>

        {/* Content Box */}
        <div style={{ background: "#ffffff", padding: "32px", borderRadius: "0 0 10px 10px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
          {submittedStatus === "ACCEPTED" ? (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "24px", borderRadius: "8px", textAlign: "center", marginBottom: "24px" }}>
              <CheckCircle2 size={40} color="#16a34a" style={{ margin: "0 auto 8px" }} />
              <h3 style={{ margin: "0 0 4px", color: "#166534" }}>Purchase Order Accepted</h3>
              <p style={{ margin: 0, color: "#15803d", fontSize: "14px" }}>
                Thank you! Your acceptance has been logged in our procurement system. Please prepare the dispatch for the designated warehouse.
              </p>
            </div>
          ) : submittedStatus === "REJECTED" ? (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "24px", borderRadius: "8px", textAlign: "center", marginBottom: "24px" }}>
              <XCircle size={40} color="#dc2626" style={{ margin: "0 auto 8px" }} />
              <h3 style={{ margin: "0 0 4px", color: "#991b1b" }}>Purchase Order Declined</h3>
              <p style={{ margin: 0, color: "#b91c1c", fontSize: "14px" }}>
                Your rejection response and remarks have been forwarded to our procurement officer for review.
              </p>
            </div>
          ) : null}

          {/* Supplier & Warehouse Details */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
            <div style={{ padding: "16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: "700", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Building2 size={14} /> Supplier Entity
              </div>
              <div style={{ fontWeight: "700", fontSize: "15px" }}>{poData?.vendor?.vendorName}</div>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{poData?.vendor?.email}</div>
            </div>

            <div style={{ padding: "16px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: "700", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <Warehouse size={14} /> Receiving Destination
              </div>
              <div style={{ fontWeight: "700", fontSize: "15px" }}>{poData?.warehouse?.warehouseName}</div>
              <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{poData?.warehouse?.location}</div>
            </div>
          </div>

          {/* Items Table */}
          <h3 style={{ fontSize: "15px", fontWeight: "700", marginBottom: "12px" }}>Order Specification</h3>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden", marginBottom: "24px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }}>
              <thead style={{ background: "#f8fafc" }}>
                <tr>
                  <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569", fontWeight: "700" }}>Item Description</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", color: "#475569", fontWeight: "700" }}>Qty</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", color: "#475569", fontWeight: "700" }}>Unit Price</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", color: "#475569", fontWeight: "700" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {poData?.items?.map((it, idx) => (
                  <tr key={idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "12px 14px" }}>
                      <strong>{it.product?.productName || "Product"}</strong>
                      {it.product?.sku && <div style={{ fontSize: "12px", color: "#64748b" }}>SKU: {it.product.sku}</div>}
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: "600" }}>{it.quantity}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>${Number(it.unitPrice || 0).toFixed(2)}</td>
                    <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: "700" }}>
                      ${(Number(it.quantity || 0) * Number(it.unitPrice || 0)).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: "#f8fafc" }}>
                <tr style={{ borderTop: "2px solid #e2e8f0" }}>
                  <td colSpan={3} style={{ padding: "12px 14px", textAlign: "right", fontWeight: "700" }}>Total Order Amount:</td>
                  <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: "800", fontSize: "16px", color: "#0f172a" }}>
                    ${Number(poData?.totalAmount || 0).toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Action Form if Pending */}
          {submittedStatus === "PENDING" && (
            <div style={{ background: "#f8fafc", padding: "20px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <h4 style={{ margin: "0 0 8px", fontSize: "14px" }}>Supplier Remarks / Fulfillment Notes</h4>
              <textarea
                rows={3}
                style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box", marginBottom: "16px" }}
                placeholder="Optional notes or required reason if rejecting order..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />

              <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => handleAction("REJECTED")}
                  disabled={submitting}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #ef4444",
                    color: "#dc2626",
                    padding: "10px 20px",
                    borderRadius: "6px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  {submitting ? "Processing..." : "Reject Order"}
                </button>
                <button
                  type="button"
                  onClick={() => handleAction("ACCEPTED")}
                  disabled={submitting}
                  style={{
                    background: "#16a34a",
                    border: "none",
                    color: "#ffffff",
                    padding: "10px 24px",
                    borderRadius: "6px",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  {submitting ? "Processing..." : "Accept Purchase Order"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VendorResponsePage;


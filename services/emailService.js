const nodemailer = require("nodemailer");
const crypto = require("crypto");

/**
 * Configure Nodemailer SMTP Transporter
 */
const getTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
};

/**
 * Generate cryptographically secure token & SHA-256 hash
 */
const generateResponseToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(token);
  return { token, hash };
};

/**
 * Hash raw token for lookup
 */
const hashToken = (token) => {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
};

/**
 * Generate professional HTML email for Vendor PO notification
 */
const generatePoEmailHtml = ({ po, vendor, warehouse, token, frontendUrl, companyName }) => {
  const responseUrl = `${frontendUrl.replace(/\/$/, "")}/vendor-response/${token}`;
  const company = companyName || "InventoryPro Supply Chain ERP";
  const vendorName = vendor?.vendorName || "Valued Supplier";
  const poNumber = po.purchaseOrderNumber;
  const poDate = po.orderDate ? new Date(po.orderDate).toLocaleDateString() : new Date().toLocaleDateString();
  const expDate = po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : "To be confirmed";
  const whName = warehouse?.warehouseName || "Designated Central Warehouse";
  const whAddress = warehouse?.location || "Main Receiving Facility";

  const itemRows = (po.items || [])
    .map(
      (item) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #1e293b;">
          <strong>${item.product?.productName || "Product"}</strong>
          ${item.product?.sku ? `<br><span style="font-size: 12px; color: #64748b;">SKU: ${item.product.sku}</span>` : ""}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #1e293b; text-align: center;">
          ${item.quantity}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #1e293b; text-align: right;">
          $${Number(item.unitPrice || 0).toFixed(2)}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #1e293b; text-align: right; font-weight: 600;">
          $${Number((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2)}
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Purchase Order ${poNumber}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; color: #ffffff;">
              <table width="100%">
                <tr>
                  <td>
                    <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">${company}</h1>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">Commercial Purchase Order Notification</p>
                  </td>
                  <td style="text-align: right;">
                    <span style="display: inline-block; padding: 6px 12px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; font-size: 13px; font-weight: 600;">
                      PO: ${poNumber}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 32px 32px 16px 32px;">
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.5;">Dear <strong>${vendorName}</strong>,</p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.5; color: #334155;">
                We have generated an approved Purchase Order <strong>${poNumber}</strong> with your firm. Please review the order specification below and confirm your acceptance.
              </p>

              <!-- Order Summary Meta -->
              <table width="100%" style="background-color: #f1f5f9; border-radius: 6px; padding: 12px 16px; margin-bottom: 24px; font-size: 13px;">
                <tr>
                  <td style="padding: 4px 0; color: #64748b; width: 40%;">Order Date:</td>
                  <td style="padding: 4px 0; font-weight: 600; color: #1e293b;">${poDate}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;">Expected Delivery:</td>
                  <td style="padding: 4px 0; font-weight: 600; color: #1e293b;">${expDate}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #64748b;">Delivery Destination:</td>
                  <td style="padding: 4px 0; font-weight: 600; color: #1e293b;">${whName} (${whAddress})</td>
                </tr>
              </table>

              <!-- Products Table -->
              <table width="100%" cellspacing="0" cellpadding="0" style="border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; margin-bottom: 20px;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 1px solid #e2e8f0;">Item</th>
                    <th style="padding: 10px 12px; text-align: center; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 1px solid #e2e8f0;">Qty</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 1px solid #e2e8f0;">Unit Price</th>
                    <th style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; border-bottom: 1px solid #e2e8f0;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
                <tfoot>
                  <tr style="background: #f8fafc;">
                    <td colspan="3" style="padding: 12px; text-align: right; font-size: 14px; font-weight: 700; color: #0f172a;">Grand Total:</td>
                    <td style="padding: 12px; text-align: right; font-size: 16px; font-weight: 700; color: #0f172a;">$${Number(po.totalAmount || 0).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              <!-- Call to Action -->
              <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 24px; text-align: center; margin-top: 24px;">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #1e3a8a;">Supplier Response Required</h3>
                <p style="margin: 0 0 16px 0; font-size: 13px; color: #3b82f6;">
                  This link will remain active for <strong>72 hours</strong>. No login or password is required.
                </p>
                <a href="${responseUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">
                  Review &amp; Respond to Purchase Order
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
              This is an automated procurement communication from ${company}.<br />
              If you have inquiries regarding this order, please contact your procurement officer.
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

/**
 * Send Purchase Order Email to Vendor
 */
const sendPurchaseOrderEmail = async ({ po, vendor, warehouse, token }) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const fromEmail = process.env.EMAIL_FROM || "procurement@inventorypro.com";
  const toEmail = vendor?.email;

  if (!toEmail) {
    return {
      success: false,
      error: "Vendor has no registered email address.",
    };
  }

  const html = generatePoEmailHtml({
    po,
    vendor,
    warehouse,
    token,
    frontendUrl,
    companyName: process.env.COMPANY_NAME || "InventoryPro ERP",
  });

  const transporter = getTransporter();

  // If SMTP is not configured (e.g. In local development or testing)
  if (!transporter) {
    console.log(`[EmailService] SMTP not configured. Simulated PO email sent to ${toEmail} for PO ${po.purchaseOrderNumber}.`);
    console.log(`[EmailService] Vendor Response Link: ${frontendUrl}/vendor-response/${token}`);
    return {
      success: true,
      simulated: true,
      messageId: `simulated-${Date.now()}`,
    };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${process.env.COMPANY_NAME || 'InventoryPro Procurement'}" <${fromEmail}>`,
      to: toEmail,
      subject: `Official Purchase Order: ${po.purchaseOrderNumber}`,
      html,
    });

    return {
      success: true,
      simulated: false,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error(`[EmailService] Failed to send email to ${toEmail}:`, error);
    return {
      success: false,
      error: error.message || "Failed to deliver email through SMTP gateway.",
    };
  }
};

module.exports = {
  getTransporter,
  generateResponseToken,
  hashToken,
  sendPurchaseOrderEmail,
};


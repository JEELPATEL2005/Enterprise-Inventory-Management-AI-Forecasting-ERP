import React, { useState, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import {
  Sparkles,
  Send,
  Plus,
  Trash2,
  FileText,
  Upload,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Copy,
  Check,
  Bot,
  User,
  ExternalLink,
  ChevronRight,
  Database,
  ShieldCheck,
  Printer,
} from "lucide-react";
import aiApi from "../../api/aiApi";
import Toast from "../../components/common/Toast";
import Modal from "../../components/common/Modal";

// Helper to format markdown text, tables, and lists cleanly
const renderMarkdown = (content) => {
  if (!content) return null;

  const lines = content.split("\n");
  const elements = [];
  let tableRows = [];
  let inTable = false;
  let listItems = [];
  let inList = false;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ paddingLeft: "20px", margin: "8px 0" }}>
          {listItems.map((li, idx) => (
            <li key={idx} style={{ marginBottom: "4px", fontSize: "13.5px", lineHeight: "1.5" }}>
              {renderInlineStyles(li)}
            </li>
          ))}
        </ul>
      );
      listItems = [];
      inList = false;
    }
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      const headerRow = tableRows[0];
      const dataRows = tableRows.slice(2); // Skip separator row

      elements.push(
        <div key={`table-wrapper-${elements.length}`} style={{ overflowX: "auto", margin: "14px 0" }}>
          <table className="erp-table" style={{ width: "100%", fontSize: "13px" }}>
            <thead>
              <tr>
                {headerRow.map((cell, idx) => (
                  <th key={idx} style={{ textTransform: "uppercase", fontSize: "11px", letterSpacing: "0.5px" }}>
                    {cell.trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>
                      {renderInlineStyles(cell.trim())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table rows detection
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      flushList();
      inTable = true;
      const cells = line.split("|").slice(1, -1);
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      flushTable();
    }

    // List items detection
    if (line.trim().startsWith("* ") || line.trim().startsWith("- ")) {
      inList = true;
      listItems.push(line.trim().substring(2));
      continue;
    } else if (inList) {
      flushList();
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(
        <h4 key={i} style={{ fontSize: "15px", fontWeight: "700", margin: "14px 0 6px 0", color: "var(--color-slate-900)" }}>
          {line.replace("### ", "")}
        </h4>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h3 key={i} style={{ fontSize: "17px", fontWeight: "700", margin: "16px 0 8px 0", color: "var(--color-slate-900)" }}>
          {line.replace("## ", "")}
        </h3>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      elements.push(
        <div
          key={i}
          style={{
            borderLeft: "3px solid var(--color-primary-500)",
            background: "var(--color-slate-50)",
            padding: "8px 12px",
            margin: "8px 0",
            fontSize: "13px",
            color: "var(--color-slate-700)",
            borderRadius: "0 6px 6px 0",
          }}
        >
          {renderInlineStyles(line.replace("> ", ""))}
        </div>
      );
      continue;
    }

    // Normal paragraph
    if (line.trim()) {
      elements.push(
        <p key={i} style={{ margin: "6px 0", fontSize: "14px", lineHeight: "1.6", color: "var(--color-slate-800)" }}>
          {renderInlineStyles(line)}
        </p>
      );
    }
  }

  flushList();
  flushTable();

  return elements;
};

// Helper for inline bold, italic, code
const renderInlineStyles = (text) => {
  if (!text) return "";
  const parts = [];
  // Tokenize bold **text** and `code`
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={match.index}
          style={{
            background: "var(--color-slate-100)",
            padding: "2px 5px",
            borderRadius: "4px",
            fontSize: "12px",
            color: "var(--color-primary-700)",
          }}
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
};

export const AiAssistantPage = () => {
  const { user } = useSelector((state) => state.auth);
  const [conversations, setConversations] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState({ online: false, mode: "" });
  const [toast, setToast] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);

  // Document RAG State
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initial Data Fetch
  useEffect(() => {
    checkServiceHealth();
    fetchConversations();
    fetchDocuments();
  }, []);

  const checkServiceHealth = async () => {
    try {
      const res = await aiApi.getHealth();
      if (res.success && res.ai_service?.status === "healthy") {
        setServiceStatus({
          online: true,
          mode: res.ai_service?.llm_provider || "Grounded Synthesis",
        });
      } else {
        setServiceStatus({ online: false, mode: "Offline" });
      }
    } catch {
      setServiceStatus({ online: false, mode: "Offline" });
    }
  };

  const fetchConversations = async () => {
    try {
      const res = await aiApi.listConversations();
      if (res.success) {
        setConversations(res.data || []);
      }
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  };

  const fetchDocuments = async () => {
    try {
      const res = await aiApi.listDocuments();
      if (res.success) {
        setDocuments(res.data || []);
      }
    } catch (err) {
      console.error("Failed to load documents:", err);
    }
  };

  const handleSelectConversation = async (threadId) => {
    setActiveThreadId(threadId);
    setLoading(true);
    try {
      const res = await aiApi.getConversation(threadId);
      if (res.success) {
        setMessages(res.messages || []);
      }
    } catch {
      setToast({ type: "error", message: "Failed to load conversation messages." });
    } finally {
      setLoading(false);
    }
  };

  const handleNewConversation = () => {
    setActiveThreadId(null);
    setMessages([]);
    setInputValue("");
  };

  const handleDeleteConversation = async (e, threadId) => {
    e.stopPropagation();
    if (!window.confirm("Delete this conversation thread?")) return;
    try {
      await aiApi.deleteConversation(threadId);
      setConversations((prev) => prev.filter((c) => c.thread_id !== threadId));
      if (activeThreadId === threadId) {
        handleNewConversation();
      }
      setToast({ type: "success", message: "Conversation deleted." });
    } catch {
      setToast({ type: "error", message: "Failed to delete conversation." });
    }
  };

  const handleSendMessage = async (queryText = null) => {
    const text = queryText || inputValue;
    if (!text || !text.trim() || loading) return;

    const userMessage = {
      role: "user",
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setLoading(true);

    try {
      const res = await aiApi.chat(text.trim(), activeThreadId);
      if (res.success) {
        const assistantMessage = {
          role: "assistant",
          content: res.data?.response,
          intent: res.data?.intent,
          tools_used: res.data?.tools_executed || [],
          citations: res.data?.citations || [],
          timestamp: new Date().toISOString(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        if (!activeThreadId && res.data?.thread_id) {
          setActiveThreadId(res.data.thread_id);
          fetchConversations();
        }
      }
    } catch (err) {
      const errDetail = err.response?.data?.message || "Failed to reach AI assistant.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ **Connection Error:** ${errDetail}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleUploadDocument = async (e) => {
    e.preventDefault();
    if (!uploadFile) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", uploadFile);
    formData.append("allowed_roles", "ALL");

    try {
      const res = await aiApi.uploadDocument(formData);
      if (res.success) {
        setToast({ type: "success", message: `Document '${uploadFile.name}' indexed into ChromaDB vector knowledgebase!` });
        setUploadFile(null);
        setIsDocModalOpen(false);
        fetchDocuments();
      }
    } catch (err) {
      setToast({ type: "error", message: err.response?.data?.message || "Document upload failed." });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (docId) => {
    if (!window.confirm("Remove this document from the AI knowledgebase?")) return;
    try {
      await aiApi.deleteDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.document_id !== docId));
      setToast({ type: "success", message: "Document removed." });
    } catch {
      setToast({ type: "error", message: "Failed to remove document." });
    }
  };

  const quickPrompts = [
    "Which products are below their reorder level?",
    "Show all pending purchase orders awaiting approval",
    "What are our top-selling products by revenue?",
    "Which shipments are delayed based on target delivery dates?",
    "Summarize total procurement spend and accounts receivable",
    "Show facility warehouse inventory and capacity utilization",
  ];

  return (
    <div style={{ display: "flex", height: "calc(100vh - 110px)", gap: "16px" }}>
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {/* LEFT SIDEBAR: Conversations & RAG Docs */}
      <div
        className="card-panel"
        style={{
          width: "280px",
          display: "flex",
          flexDirection: "column",
          padding: "16px",
          margin: 0,
          borderRadius: "var(--radius-lg)",
        }}
      >
        <button
          type="button"
          className="btn-primary"
          onClick={handleNewConversation}
          style={{ width: "100%", justifyContent: "center", marginBottom: "16px" }}
        >
          <Plus size={16} />
          <span>New Conversation</span>
        </button>

        <div style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: "var(--color-slate-400)", marginBottom: "8px" }}>
          Recent Queries
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
          {conversations.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--color-slate-400)", textAlign: "center", padding: "20px 0" }}>
              No previous conversations
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = activeThreadId === c.thread_id;
              return (
                <div
                  key={c.thread_id}
                  onClick={() => handleSelectConversation(c.thread_id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    background: isActive ? "var(--color-primary-50)" : "transparent",
                    color: isActive ? "var(--color-primary-700)" : "var(--color-slate-700)",
                    border: isActive ? "1px solid var(--color-primary-200)" : "1px solid transparent",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                    <Bot size={15} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.6 }} />
                    <span style={{ fontSize: "13px", fontWeight: isActive ? "600" : "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.title || "Query"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteConversation(e, c.thread_id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-slate-400)", padding: "2px" }}
                    title="Delete thread"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* RAG Knowledgebase Section */}
        <div style={{ borderTop: "1px solid var(--color-slate-200)", paddingTop: "14px", marginTop: "12px" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setIsDocModalOpen(true)}
            style={{ width: "100%", justifyContent: "center", fontSize: "12px" }}
          >
            <FileText size={14} />
            <span>SOP & Policy Docs ({documents.length})</span>
          </button>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div
        className="card-panel"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: 0,
          margin: 0,
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-slate-100)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#ffffff",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, var(--color-primary-600), #6366f1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
              }}
            >
              <Sparkles size={20} />
            </div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "var(--color-slate-900)" }}>
                InventoryPro Intelligence Assistant
              </div>
              <div style={{ fontSize: "12px", color: "var(--color-slate-500)", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>LangGraph &bull; Grounded Database Retrieval</span>
                <span style={{ color: "var(--color-slate-300)" }}>&bull;</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      backgroundColor: serviceStatus.online ? "var(--color-emerald-500)" : "var(--color-rose-500)",
                    }}
                  />
                  {serviceStatus.online ? `Online (${serviceStatus.mode})` : "Service Offline"}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.print()}
              title="Print / Export Report"
              style={{ fontSize: "12px" }}
            >
              <Printer size={14} />
              <span>Export</span>
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={checkServiceHealth}
              title="Check AI Connection"
              style={{ fontSize: "12px" }}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {/* Message Feed */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            background: "var(--color-slate-50)",
          }}
        >
          {messages.length === 0 ? (
            <div style={{ margin: "auto", maxWidth: "640px", textAlign: "center", padding: "20px" }}>
              <div
                style={{
                  width: "60px",
                  height: "60px",
                  borderRadius: "16px",
                  background: "var(--color-primary-50)",
                  color: "var(--color-primary-600)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px auto",
                }}
              >
                <Sparkles size={32} />
              </div>
              <h2 style={{ fontSize: "20px", fontWeight: "800", color: "var(--color-slate-900)", marginBottom: "8px" }}>
                How can I assist your business operations today?
              </h2>
              <p style={{ fontSize: "14px", color: "var(--color-slate-500)", marginBottom: "24px", lineHeight: "1.5" }}>
                Ask real-time questions across Inventory, Purchase Orders, Sales Revenue, Inbound GRNs, and Dispatches.
                Responses are strictly grounded in your authorized MongoDB records.
              </p>

              <div style={{ textAlign: "left", marginBottom: "12px", fontSize: "12px", fontWeight: "700", color: "var(--color-slate-400)", textTransform: "uppercase" }}>
                Suggested Prompts:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {quickPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(prompt)}
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      background: "#ffffff",
                      border: "1px solid var(--color-slate-200)",
                      borderRadius: "8px",
                      fontSize: "13px",
                      color: "var(--color-slate-700)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--color-primary-500)";
                      e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--color-slate-200)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <span>{prompt}</span>
                    <ChevronRight size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignSelf: isUser ? "flex-end" : "flex-start",
                    maxWidth: isUser ? "80%" : "95%",
                  }}
                >
                  {!isUser && (
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "var(--color-primary-600)",
                        color: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "2px",
                      }}
                    >
                      <Bot size={18} />
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {/* Meta bar for assistant messages */}
                    {!isUser && (m.intent || (m.tools_used && m.tools_used.length > 0)) && (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}>
                        {m.intent && (
                          <span className="badge badge-info" style={{ fontSize: "10px", padding: "2px 6px" }}>
                            {m.intent}
                          </span>
                        )}
                        {(m.tools_used || []).map((t, tIdx) => (
                          <span
                            key={tIdx}
                            style={{
                              fontSize: "11px",
                              background: "var(--color-slate-200)",
                              color: "var(--color-slate-700)",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontFamily: "monospace",
                            }}
                          >
                            🔧 {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div
                      style={{
                        padding: "14px 18px",
                        borderRadius: "10px",
                        background: isUser ? "var(--color-primary-600)" : "#ffffff",
                        color: isUser ? "#ffffff" : "var(--color-slate-900)",
                        border: isUser ? "none" : "1px solid var(--color-slate-200)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                      }}
                    >
                      {isUser ? (
                        <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.5" }}>{m.content}</p>
                      ) : (
                        renderMarkdown(m.content)
                      )}

                      {/* RAG Citations */}
                      {!isUser && m.citations && m.citations.length > 0 && (
                        <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px dashed var(--color-slate-200)" }}>
                          <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: "var(--color-slate-500)" }}>
                            Referenced Knowledge Sources:
                          </span>
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
                            {m.citations.map((cite, cIdx) => (
                              <span
                                key={cIdx}
                                className="badge badge-pending"
                                style={{ fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                              >
                                <FileText size={11} /> {cite}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action pill underneath */}
                    {!isUser && (
                      <div style={{ display: "flex", gap: "8px", marginTop: "2px", alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => handleCopy(m.content, idx)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--color-slate-400)",
                            fontSize: "11px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 6px",
                          }}
                        >
                          {copiedIdx === idx ? <Check size={12} color="var(--color-emerald-600)" /> : <Copy size={12} />}
                          <span>{copiedIdx === idx ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "var(--color-slate-300)",
                        color: "var(--color-slate-700)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "2px",
                      }}
                    >
                      <User size={18} />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {loading && (
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  background: "var(--color-primary-600)",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Bot size={18} />
              </div>
              <div
                style={{
                  background: "#ffffff",
                  padding: "12px 18px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-slate-200)",
                  fontSize: "13.5px",
                  color: "var(--color-slate-600)",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <RefreshCw size={14} className="spin" />
                <span>Analyzing ERP operational records and executing safe database tools...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div style={{ padding: "16px 20px", background: "#ffffff", borderTop: "1px solid var(--color-slate-100)" }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{ display: "flex", gap: "10px", alignItems: "center" }}
          >
            <input
              type="text"
              className="form-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask anything about inventory, PO approvals, top sales, delays, or company SOPs..."
              disabled={loading}
              style={{ flex: 1, height: "46px", fontSize: "14px", borderRadius: "8px" }}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !inputValue.trim()}
              style={{ height: "46px", padding: "0 22px", borderRadius: "8px" }}
            >
              <Send size={16} />
              <span>Ask</span>
            </button>
          </form>
          <div style={{ fontSize: "11.5px", color: "var(--color-slate-400)", marginTop: "6px", textAlign: "center" }}>
            Strict Read-Only Architecture &bull; No live vehicle GPS telemetry is stored in this ERP &bull; Verified Database Grounding
          </div>
        </div>
      </div>

      {/* RAG KNOWLEDGEBASE MODAL */}
      <Modal isOpen={isDocModalOpen} onClose={() => setIsDocModalOpen(false)} title="Company SOP & Policy Vector Knowledgebase">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ fontSize: "13.5px", color: "var(--color-slate-600)", margin: 0 }}>
            Upload standard operating procedures, return policy guidelines, and vendor agreements (.pdf, .docx, .txt).
            These documents are indexed into the local ChromaDB vector database and used to answer organizational questions.
          </p>

          <form onSubmit={handleUploadDocument} style={{ display: "flex", gap: "10px", alignItems: "center", background: "var(--color-slate-50)", padding: "12px", borderRadius: "8px" }}>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md"
              onChange={(e) => setUploadFile(e.target.files[0])}
              required
              style={{ fontSize: "13px" }}
            />
            <button type="submit" className="btn-primary" disabled={uploading || !uploadFile} style={{ flexShrink: 0 }}>
              <Upload size={14} />
              <span>{uploading ? "Indexing..." : "Upload & Index"}</span>
            </button>
          </form>

          <div style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "var(--color-slate-400)" }}>
            Currently Indexed Documents ({documents.length})
          </div>

          {documents.length === 0 ? (
            <div className="empty-state" style={{ padding: "24px" }}>
              <FileText size={32} style={{ opacity: 0.3, margin: "0 auto 8px auto" }} />
              <p>No company documents currently indexed in ChromaDB.</p>
            </div>
          ) : (
            <table className="erp-table">
              <thead>
                <tr>
                  <th>Document Name</th>
                  <th>Indexed Chunks</th>
                  <th>Uploaded</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.document_id}>
                    <td style={{ fontWeight: "600" }}>{d.filename}</td>
                    <td>{d.total_chunks} vectors</td>
                    <td style={{ fontSize: "12px", color: "var(--color-slate-500)" }}>
                      {d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString() : "Active"}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDeleteDocument(d.document_id)}
                        className="action-icon-btn"
                        style={{ color: "var(--color-rose-600)" }}
                        title="Delete from knowledgebase"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default AiAssistantPage;


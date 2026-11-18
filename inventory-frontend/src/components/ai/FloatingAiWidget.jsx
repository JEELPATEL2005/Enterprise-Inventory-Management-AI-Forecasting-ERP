import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Sparkles,
  X,
  Send,
  Maximize2,
  Bot,
  User,
  ShieldCheck,
  RotateCcw,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import aiApi from "../../api/aiApi";

export default function FloatingAiWidget() {
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);

  const [isOpen, setIsOpen] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Initialize or restore conversation thread ID
  useEffect(() => {
    let savedThreadId = localStorage.getItem("inventorypro_floating_ai_thread");
    if (!savedThreadId) {
      savedThreadId = "thread_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
      localStorage.setItem("inventorypro_floating_ai_thread", savedThreadId);
    }
    setThreadId(savedThreadId);

    // Initial greeting if no messages
    setMessages([
      {
        id: "msg_welcome",
        role: "assistant",
        content: `Hello ${user?.name ? user.name.split(" ")[0] : "there"}! I'm your InventoryPro ERP AI Assistant. You can ask me about stock levels, purchase orders, shipments, delivery status, and company policies.`,
        created_at: new Date().toISOString(),
      },
    ]);
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        scrollToBottom();
      }, 100);
    }
  }, [isOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || inputValue).trim();
    if (!query || isLoading) return;

    setError(null);
    const userMsg = {
      id: "usr_" + Date.now(),
      role: "user",
      content: query,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await aiApi.sendMessage({
        message: query,
        threadId: threadId,
      });

      const aiMsg = {
        id: "ast_" + Date.now(),
        role: "assistant",
        content: response.reply || "No response received.",
        guardrail_triggered: response.guardrail_triggered,
        sources: response.sources || [],
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      console.error("Floating AI send error:", err);
      const errMsg =
        err.response?.data?.message ||
        "Failed to reach the ERP AI Assistant. Please ensure the AI service is running.";
      setError(errMsg);
      setMessages((prev) => [
        ...prev,
        {
          id: "err_" + Date.now(),
          role: "assistant",
          content: `⚠️ Error: ${errMsg}`,
          isError: true,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleReset = () => {
    const newThread = "thread_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    setThreadId(newThread);
    localStorage.setItem("inventorypro_floating_ai_thread", newThread);
    setMessages([
      {
        id: "msg_welcome",
        role: "assistant",
        content: `Conversation reset. How can I assist you with InventoryPro operations?`,
        created_at: new Date().toISOString(),
      },
    ]);
    setError(null);
  };

  const quickPrompts = [
    "Which products are low on stock?",
    "Show pending purchase orders",
    "Which shipments are delayed?",
    "Summarize warehouse stock",
  ];

  return (
    <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 9999 }}>
      {/* Popover Window */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "64px",
            right: "0",
            width: "400px",
            height: "560px",
            maxHeight: "85vh",
            maxWidth: "92vw",
            background: "#ffffff",
            borderRadius: "16px",
            boxShadow: "0 20px 40px -10px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(15, 23, 42, 0.08)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "fadeInUp 0.2s ease-out",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "14px 16px",
              background: "linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "10px",
                  background: "rgba(255, 255, 255, 0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backdropFilter: "blur(4px)",
                }}
              >
                <Sparkles size={18} color="#ffffff" />
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: "700", letterSpacing: "0.2px" }}>
                  ERP AI Assistant
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "rgba(255, 255, 255, 0.8)",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#10b981",
                      display: "inline-block",
                    }}
                  />
                  Live ERP Grounded
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                onClick={handleReset}
                title="Reset conversation"
                style={{
                  background: "rgba(255, 255, 255, 0.15)",
                  border: "none",
                  borderRadius: "6px",
                  width: "28px",
                  height: "28px",
                  color: "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s",
                }}
              >
                <RotateCcw size={14} />
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate("/ai/assistant");
                }}
                title="Open full page"
                style={{
                  background: "rgba(255, 255, 255, 0.15)",
                  border: "none",
                  borderRadius: "6px",
                  width: "28px",
                  height: "28px",
                  color: "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s",
                }}
              >
                <Maximize2 size={14} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                title="Close"
                style={{
                  background: "rgba(255, 255, 255, 0.15)",
                  border: "none",
                  borderRadius: "6px",
                  width: "28px",
                  height: "28px",
                  color: "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s",
                }}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Logistics Disclaimer Banner */}
          <div
            style={{
              padding: "6px 12px",
              background: "#fef3c7",
              borderBottom: "1px solid #fde68a",
              color: "#92400e",
              fontSize: "11px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              lineHeight: "1.3",
            }}
          >
            <ShieldCheck size={13} style={{ flexShrink: 0 }} />
            <span>Read-only authorized data. No live GPS hardware tracking.</span>
          </div>

          {/* Messages Area */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px",
              background: "#f8fafc",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    justifyContent: isUser ? "flex-end" : "flex-start",
                    gap: "8px",
                  }}
                >
                  {!isUser && (
                    <div
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "50%",
                        background: "#e0e7ff",
                        color: "#4f46e5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "2px",
                      }}
                    >
                      <Bot size={15} />
                    </div>
                  )}

                  <div
                    style={{
                      maxWidth: "82%",
                      padding: "10px 13px",
                      borderRadius: isUser ? "14px 14px 2px 14px" : "14px 14px 14px 2px",
                      background: isUser
                        ? "#4f46e5"
                        : msg.isError
                        ? "#fee2e2"
                        : "#ffffff",
                      color: isUser
                        ? "#ffffff"
                        : msg.isError
                        ? "#991b1b"
                        : "#0f172a",
                      fontSize: "13px",
                      lineHeight: "1.5",
                      boxShadow: isUser ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
                      border: isUser ? "none" : "1px solid #e2e8f0",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {msg.content}

                    {msg.sources && msg.sources.length > 0 && (
                      <div
                        style={{
                          marginTop: "8px",
                          paddingTop: "6px",
                          borderTop: "1px solid #e2e8f0",
                          fontSize: "11px",
                          color: "#64748b",
                        }}
                      >
                        <strong>Sources:</strong> {msg.sources.join(", ")}
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "50%",
                        background: "#e2e8f0",
                        color: "#475569",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: "2px",
                      }}
                    >
                      <User size={14} />
                    </div>
                  )}
                </div>
              );
            })}

            {isLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    width: "26px",
                    height: "26px",
                    borderRadius: "50%",
                    background: "#e0e7ff",
                    color: "#4f46e5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Bot size={15} />
                </div>
                <div
                  style={{
                    padding: "8px 12px",
                    background: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "14px 14px 14px 2px",
                    fontSize: "12.5px",
                    color: "#64748b",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#4f46e5",
                      animation: "pulse 1s infinite alternate",
                    }}
                  />
                  Querying authorized ERP data...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts */}
          {messages.length <= 2 && (
            <div
              style={{
                padding: "8px 12px",
                background: "#f1f5f9",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                gap: "6px",
                overflowX: "auto",
                whiteSpace: "nowrap",
              }}
            >
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(prompt)}
                  style={{
                    padding: "4px 9px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "12px",
                    fontSize: "11.5px",
                    color: "#334155",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "border-color 0.15s",
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Input Box */}
          <div
            style={{
              padding: "10px 12px",
              background: "#ffffff",
              borderTop: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about ERP operations..."
              disabled={isLoading}
              style={{
                flex: 1,
                border: "1px solid #cbd5e1",
                borderRadius: "20px",
                padding: "8px 14px",
                fontSize: "13px",
                outline: "none",
                transition: "border-color 0.15s",
              }}
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputValue.trim() || isLoading}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: !inputValue.trim() || isLoading ? "#cbd5e1" : "#4f46e5",
                color: "#ffffff",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: !inputValue.trim() || isLoading ? "not-allowed" : "pointer",
                transition: "background 0.15s",
                flexShrink: 0,
              }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Trigger Floating Action Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)",
          color: "#ffffff",
          border: "none",
          boxShadow: "0 10px 25px -3px rgba(79, 70, 229, 0.4), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.06)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        title="Open ERP AI Assistant"
      >
        {isOpen ? <X size={24} /> : <Sparkles size={24} />}
        {!isOpen && (
          <span
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              background: "#10b981",
              border: "2px solid #ffffff",
            }}
          />
        )}
      </button>
    </div>
  );
}


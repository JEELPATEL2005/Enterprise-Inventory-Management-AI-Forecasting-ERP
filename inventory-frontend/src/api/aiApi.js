import api from "./axios";

export const aiApi = {
  chat: async (query, threadId = null) => {
    const res = await api.post("/api/ai/chat", {
      query,
      thread_id: threadId,
    });
    return res.data;
  },

  listConversations: async () => {
    const res = await api.get("/api/ai/conversations");
    return res.data;
  },

  getConversation: async (threadId) => {
    const res = await api.get(`/api/ai/conversations/${threadId}`);
    return res.data;
  },

  deleteConversation: async (threadId) => {
    const res = await api.delete(`/api/ai/conversations/${threadId}`);
    return res.data;
  },

  listDocuments: async () => {
    const res = await api.get("/api/ai/documents");
    return res.data;
  },

  uploadDocument: async (formData) => {
    const res = await api.post("/api/ai/documents/upload", formData, {
      headers: { "Content-Type": undefined },
    });
    return res.data;
  },

  deleteDocument: async (docId) => {
    const res = await api.delete(`/api/ai/documents/${docId}`);
    return res.data;
  },

  getHealth: async () => {
    const res = await api.get("/api/ai/health");
    return res.data;
  },
};

export default aiApi;


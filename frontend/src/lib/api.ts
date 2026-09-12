import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api/vynora', // URL to our Node.js backend
  headers: {
    'Content-Type': 'application/json'
  }
});

// Centralized endpoints
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats').then(res => res.data),
  getFeed: () => api.get('/dashboard/feed').then(res => res.data),
  getLeads: () => api.get('/dashboard/leads').then(res => res.data),
  getPipeline: () => api.get('/dashboard/pipeline').then(res => res.data),
  getConfig: () => api.get('/dashboard/config').then(res => res.data),
  updateConfig: (data: { key: string, value: string }) => api.post('/dashboard/config', data).then(res => res.data),
  getNotifications: () => api.get('/dashboard/notifications').then(res => res.data),
  getOutreachQueue: () => api.get('/dashboard/outreach/queue').then(res => res.data),
  purgeOutreachQueue: () => api.delete('/dashboard/outreach/queue').then(res => res.data),
  getInboxMessages: () => api.get('/dashboard/outreach/inbox').then(res => res.data),
  getFinance: () => api.get('/dashboard/finance').then(res => res.data),
  forceRunSourcing: () => api.post('/sourcing-run').then(res => res.data),
  getHealth: () => api.get('/health').then(res => res.data),
};

export default api;

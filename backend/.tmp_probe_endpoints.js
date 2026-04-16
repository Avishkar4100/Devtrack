const axios = require('axios');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5ZDY1M2IyNGY0NGU2MWQxNDY4YzgyZSIsImlhdCI6MTc3NTY1NTg5MiwiZXhwIjoxNzc1NjYzMDkyfQ.CelBMBjw5U_2vVb_xjpu2_YITbMOlFgBRdFCc5yrbe0';
const projectId = '69d653b74f44e61d1468c837';

const api = axios.create({
  baseURL: 'http://localhost:5000/api',
  timeout: 20000,
  headers: { Authorization: `Bearer ${token}` }
});

const endpoints = [
  ['GET', `/projects/${projectId}`],
  ['GET', `/dashboard/${projectId}`],
  ['GET', `/dashboard/${projectId}/control-tower`],
  ['GET', `/stories/epics/${projectId}`],
  ['GET', `/stories/project/${projectId}`],
  ['GET', `/documents/project/${projectId}`],
  ['GET', `/insights/${projectId}`],
  ['GET', `/github/commits/${projectId}`],
  ['GET', '/jira/server/projects'],
];

(async()=>{
  for (const [method, url] of endpoints) {
    try {
      const r = await api.request({ method, url });
      const msg = r.data?.message || r.data?.integration?.message || 'ok';
      console.log(`${method} ${url} -> ${r.status} :: ${msg}`);
    } catch (e) {
      const status = e.response?.status || 'ERR';
      const msg = e.response?.data?.message || e.message;
      const reqId = e.response?.data?.requestId || e.response?.headers?.['x-request-id'] || '';
      console.log(`${method} ${url} -> ${status} :: ${msg}${reqId ? ` (ref:${reqId})` : ''}`);
    }
  }
})();

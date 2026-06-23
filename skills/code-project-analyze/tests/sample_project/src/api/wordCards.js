// src/api/wordCards.js —— 词卡 API 客户端（样例源码）
import axios from 'axios';

const BASE = import.meta.env.VITE_API_BASE || '/api/v4';

// 获取分组树
export async function getGroupTree() {
  return axios.get(`${BASE}/word-cards/groups/tree`).then(r => r.data);
}

// 创建词卡
export async function createCard(payload) {
  return axios.post(`${BASE}/word-cards`, payload).then(r => r.data);
}

// 更新词卡
export async function updateCard(id, payload) {
  return axios.put(`${BASE}/word-cards/${id}`, payload).then(r => r.data);
}

// 删除词卡
export async function deleteCard(id) {
  return axios.delete(`${BASE}/word-cards/${id}`).then(r => r.data);
}

// 语义搜索
export async function searchCards(query) {
  return axios.post(`${BASE}/word-cards/search`, { q: query }).then(r => r.data);
}

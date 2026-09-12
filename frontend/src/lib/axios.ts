import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// For Vynora specific backend hooks (if they were implemented)
export const vynoraApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_VYNORA_API_URL || "http://localhost:3000/api/vynora",
  timeout: 30000, // Sourcing might take long
  headers: {
    "Content-Type": "application/json",
  },
});

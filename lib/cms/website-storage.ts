import { getWebsite } from "./website-registry";
const KEY = "ber-workshed-active-website-v1";
export function readActiveWebsiteId(fallback: string) { if (typeof window === "undefined") return fallback; try { const saved = window.localStorage.getItem(KEY); return saved && getWebsite(saved) ? saved : fallback; } catch { return fallback; } }
export function writeActiveWebsiteId(websiteId: string) { try { window.localStorage.setItem(KEY, websiteId); return true; } catch { return false; } }

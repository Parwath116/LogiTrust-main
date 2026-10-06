// Point this at your running backend (see server/.env PORT).
// Easily configurable per environment:
// 1. Via URL parameter: ?api=http://<host>:<port> (saved to localStorage for persistence)
// 2. Via localStorage: localStorage.setItem("LOGITRUST_API_BASE", "http://<host>:<port>")
// 3. Via window global: window.LOGITRUST_API_BASE = "http://<host>:<port>"
// 4. Fallback default: http://localhost:4000
const API_BASE = (function () {
  if (typeof window !== "undefined") {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryApi = urlParams.get("api");
      if (queryApi) {
        localStorage.setItem("LOGITRUST_API_BASE", queryApi);
        return queryApi;
      }
      const storedApi = localStorage.getItem("LOGITRUST_API_BASE") || localStorage.getItem("API_BASE");
      if (storedApi) return storedApi;
      if (window.LOGITRUST_API_BASE) return window.LOGITRUST_API_BASE;
    } catch (_) {}
  }
  return "http://localhost:4000";
})();

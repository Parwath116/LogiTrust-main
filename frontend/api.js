const LogiTrustAPI = (() => {
  function token() {
    return localStorage.getItem("logitrust_jwt");
  }

  async function call(path, options = {}) {
    // Force cache bypass by appending timestamp if it's a GET request
    const isGet = !options.method || options.method === "GET";
    const finalPath = isGet ? path + (path.includes("?") ? "&" : "?") + "_t=" + Date.now() : path;
    const res = await fetch(API_BASE + finalPath, {
      cache: "no-store",
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      localStorage.removeItem("logitrust_jwt");
      window.location.href = "index.html";
      return null;
    }
    return res.json();
  }

  return {
    me: () => call("/auth/me"),
    listShipments: () => call("/api/shipments"),
    createShipment: (data) => call("/api/shipments", { method: "POST", body: JSON.stringify(data) }),
    flagDelay: (id) => call(`/api/shipments/${id}/flag-delay`, { method: "POST" }),
    adminResolve: (id, action) => call(`/api/shipments/${id}/admin-resolve`, { method: "POST", body: JSON.stringify({ action }) }),
    approveEscrow: (id) => call(`/api/escrow/${id}/approve`, { method: "POST" }),
    disputeEscrow: (id) => call(`/api/escrow/${id}/dispute`, { method: "POST" }),
    getNotifications: () => call("/auth/notifications"),
    isLoggedIn: () => !!token(),
    logout: () => {
      localStorage.removeItem("logitrust_jwt");
      window.location.href = "index.html";
    },
  };
})();

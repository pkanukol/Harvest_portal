import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function LoginView() {
  const portalUrl = import.meta.env.VITE_PORTAL_URL || "http://localhost:3000/portal/login.html";

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="brand-section">
          <img src="/logo.png" alt="Harvest International School" className="brand-logo-img" />
          <div className="brand-tagline">Academic Quality Audit</div>
        </div>
        <p style={{ textAlign: "center", fontSize: "14px", color: "#666", marginBottom: "20px" }}>
          Please sign in through the school portal to access this app.
        </p>
        <a
          href={portalUrl}
          style={{
            display: "block",
            textAlign: "center",
            padding: "12px 24px",
            background: "#3893C4",
            color: "#fff",
            borderRadius: "8px",
            textDecoration: "none",
            fontWeight: "600",
            fontSize: "14px",
          }}
        >
          Go to School Portal →
        </a>
      </div>
    </div>
  );
}

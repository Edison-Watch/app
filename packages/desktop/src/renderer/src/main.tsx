import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./assets/main.css";

// Older versions cached a per-user key here. Nothing reads it any more.
try {
  localStorage.removeItem("sealgate_secret_key");
} catch {
  // Storage unavailable: nothing was cached either.
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

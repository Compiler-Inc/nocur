// Must be first import for why-did-you-render to work
import "./wdyr";
// Debug utilities (exposes window.__DEBUG__ in dev mode)
import "./lib/debug";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

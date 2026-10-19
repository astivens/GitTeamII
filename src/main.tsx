import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme } from "./lib/theme";
import { useTicketsStore } from "./store/tickets";

// The token sets live in CSS under `[data-theme]`, so the document has to carry
// the remembered theme before the first paint — otherwise a launch flashes the
// default one. The store already read it when it was created.
applyTheme(useTicketsStore.getState().theme);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

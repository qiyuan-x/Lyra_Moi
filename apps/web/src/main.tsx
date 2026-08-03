import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { applyAppearanceMode, readAppearanceMode } from "./lib/appearance.js";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing.");

applyAppearanceMode(readAppearanceMode());

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

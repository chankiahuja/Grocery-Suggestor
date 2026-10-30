import { createRoot } from "react-dom/client";

import App from "./App";

import "./index.css";
import "./pantry-theme.css";
import "./auth.css";

async function start() {
  if (import.meta.env.MODE === "mock") {
    const { installMockApi } = await import("./mocks/pantry-api");
    installMockApi();
  }
  createRoot(document.getElementById("root")!).render(<App />);
}
void start();

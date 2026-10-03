import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Design-system CSS first, so page-level stylesheets (imported by the pages) can override it.
import "./styles/design-system.css";
import App from "./App";
import { WalletProvider } from "./lib/wallet";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);

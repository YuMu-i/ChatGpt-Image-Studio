import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "@/App";
import { PortalSessionProvider } from "@/store/session";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/portal">
      <PortalSessionProvider>
        <App />
      </PortalSessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

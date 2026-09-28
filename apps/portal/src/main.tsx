import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";

import App from "./App";
import { completeEnvironmentHandoff } from "./lib/auth";
import { bootstrapLocale } from "./lib/i18n";
import { applyTheme, loadProgramConfig } from "./lib/theme";

const config = loadProgramConfig();
applyTheme(config.accentColor, config.theme);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");
const rootElement: HTMLElement = rootEl;

function LocalizedApp(): JSX.Element {
  const { i18n: activeI18n } = useTranslation();
  return <App key={activeI18n.language} />;
}

function renderApp(): void {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <LocalizedApp />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

function showHandoffFailure(): void {
  rootElement.replaceChildren();
  const message = document.createElement("p");
  message.className = "m-8 text-sm text-red-700";
  message.textContent = "Không thể chuyển môi trường. Liên kết đăng nhập bảo mật có thể đã hết hạn; hãy quay lại môi trường trước và thử lại.";
  rootElement.append(message);
}

void bootstrapLocale()
  .then(completeEnvironmentHandoff)
  .then(renderApp)
  .catch((error: unknown) => {
    console.error("Environment sign-in handoff failed", error);
    showHandoffFailure();
  });

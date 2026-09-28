import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import i18n from "./i18n";
import { completeEnvironmentHandoff } from "./lib/api-client";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}
const appRootElement: HTMLElement = rootElement;

function LocalizedApp(): JSX.Element {
  const { i18n: activeI18n } = useTranslation();
  return <App key={activeI18n.language} />;
}

function renderApp(): void {
  createRoot(appRootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <BrowserRouter>
            <LocalizedApp />
          </BrowserRouter>
        </I18nextProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

function showHandoffFailure(): void {
  appRootElement.replaceChildren();
  const message = document.createElement("p");
  message.className = "m-8 text-sm text-red-700";
  message.textContent = "Could not switch environments. The secure sign-in link may have expired; return to the previous environment and try again.";
  appRootElement.append(message);
}

void completeEnvironmentHandoff().then(renderApp).catch((error: unknown) => {
  console.error("Environment sign-in handoff failed", error);
  showHandoffFailure();
});

import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import i18n from "./i18n";

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

renderApp();

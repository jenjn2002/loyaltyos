import "./ui/error-message.js";
import "./ui/spinner.js";

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import { fetchApi } from "../lib/api-client.js";
import { formatPoints } from "../lib/format.js";
import { WidgetConfigController } from "../lib/widget-config.js";
import type { Balance } from "../types.js";

@customElement("loyalty-points-card")
export class LoyaltyPointsCard extends LitElement {
  private controller = new WidgetConfigController(this);

  @state() private data: Balance | null = null;
  @state() private loading = false;
  @state() private error = "";

  static override styles = css`
    :host {
      display: block;
      font-family: var(--loy-font-family);
    }
    .balance-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
      gap: var(--loy-space-md);
    }
    .stat {
      background: var(--loy-color-surface);
      border: 1px solid var(--loy-color-border);
      border-radius: var(--loy-radius-lg);
      padding: var(--loy-space-lg);
      text-align: center;
    }
    .stat-label {
      font-size: var(--loy-font-size-sm);
      color: var(--loy-color-text-secondary);
      margin-bottom: var(--loy-space-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: var(--loy-font-size-xl);
      font-weight: var(--loy-font-weight-bold);
      color: var(--loy-color-text);
    }
  `;

  private onBalanceUpdated = (): void => {
    void this.fetchData();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("loyaltyos:balance-updated", this.onBalanceUpdated);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("loyaltyos:balance-updated", this.onBalanceUpdated);
  }

  override firstUpdated(): void {
    void this.fetchData();
  }

  private fetchData = async (): Promise<void> => {
    if (!this.controller.hasConfig || !this.controller.isAuthenticated) return;
    this.loading = true;
    this.error = "";
    try {
      this.data = await fetchApi<Balance>(this.controller.config, `/members/me/balance`);
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loading = false;
    }
  };

  override render() {
    if (!this.controller.isAuthenticated) return null;
    const locale = this.controller.locale;
    if (this.loading) return html`<loy-spinner .locale=${locale}></loy-spinner>`;
    if (this.error)
      return html`<loy-error
        message=${this.error}
        retryable
        .locale=${locale}
        @loy-retry=${this.fetchData}
      ></loy-error>`;
    if (!this.data) return null;

    return html`
      <div class="balance-grid">
        ${this.data.wallets.map((wallet) => html`
          <div class="stat" data-point-type="${wallet.code}">
            <div class="stat-label">${wallet.name || wallet.code}</div>
            <div class="stat-value">${formatPoints(wallet.balance, locale)} ${wallet.unitLabel}</div>
          </div>
        `)}
      </div>
    `;
  }
}

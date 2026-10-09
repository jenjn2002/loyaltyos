// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AutoFieldHelp } from "../ui/auto-field-help";

afterEach(cleanup);

describe("AutoFieldHelp", () => {
  it("uses only the contextual label text and lets explicit help override generic expiry wording", async () => {
    render(
      <>
        <AutoFieldHelp />
        <label htmlFor="api-group">
          API group
          <select id="api-group">
            <option value="all">All groups</option>
            <option value="wallets">Wallets, credits, and a long list of API options</option>
          </select>
        </label>
        <label htmlFor="api-key-expiry">
          Expires in (days)
          <input
            id="api-key-expiry"
            data-help="Controls API key validity until its expiry date; it does not expire member points."
          />
        </label>
        <label htmlFor="amount">Amount<input id="amount" /></label>
        <label htmlFor="point-amount">Point amount<input id="point-amount" /></label>
        <label htmlFor="item-expiry">Expiry date<input id="item-expiry" /></label>
      </>,
    );

    await waitFor(() => {
      expect(document.querySelector('label[for="api-group"]')?.getAttribute("title")).toBeTruthy();
      expect(document.querySelector('label[for="api-key-expiry"]')?.getAttribute("title")).toBeTruthy();
      expect(document.querySelector('label[for="amount"]')?.getAttribute("title")).toBeTruthy();
      expect(document.querySelector('label[for="point-amount"]')?.getAttribute("title")).toBeTruthy();
      expect(document.querySelector('label[for="item-expiry"]')?.getAttribute("title")).toBeTruthy();
    });

    const groupHelp = document.querySelector('label[for="api-group"]')?.getAttribute("title") ?? "";
    expect(groupHelp).toContain('“API group”');
    expect(groupHelp).not.toContain("All groups");
    expect(groupHelp).not.toContain("Wallets, credits");

    const expiryHelp = document.querySelector('label[for="api-key-expiry"]')?.getAttribute("title") ?? "";
    expect(expiryHelp).toContain("API key validity");
    expect(expiryHelp).not.toContain("member wallet");

    const amountHelp = document.querySelector('label[for="amount"]')?.getAttribute("title") ?? "";
    expect(amountHelp).toContain("numeric quantity");
    expect(amountHelp).not.toContain("wallet");
    expect(document.querySelector('label[for="point-amount"]')?.getAttribute("title")).toContain("point type");
    expect(document.querySelector('label[for="item-expiry"]')?.getAttribute("title")).not.toContain("member wallet");
  });
});

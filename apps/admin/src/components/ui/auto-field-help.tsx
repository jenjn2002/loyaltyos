import { useEffect } from "react";

const FIELD_DEFINITIONS: [RegExp, string][] = [
  [
    /point type|wallet|credit type/i,
    "The configurable balance type this value belongs to. Each type can have its own expiry, Give, redemption, exchange and visibility rules.",
  ],
  [
    /code/i,
    "A stable, unique identifier used by APIs, imports and integrations. Avoid changing it after launch.",
  ],
  [
    /unit label/i,
    "The singular or collective unit shown beside balances, for example points, credits or tokens.",
  ],
  [
    /expiry mode/i,
    "Controls whether value never expires, expires after a number of days, on one fixed date, or per individual grant.",
  ],
  [
    /expiry|expires/i,
    "The date or duration after which unused value is removed from the member wallet.",
  ],
  [/warning/i, "Days before expiry when the member should receive an expiry reminder."],
  [
    /allowance/i,
    "A separate renewable Give budget. Spending it does not reduce the giver’s owned wallet balance.",
  ],
  [/carry.?over/i, "When enabled, unused allowance is added to the next allowance cycle."],
  [
    /source/i,
    "Where this operation originates. Give can consume either the member’s owned balance or a separate allowance.",
  ],
  [
    /destination|target/i,
    "The point type received by the recipient. Only explicitly enabled source-to-target paths are allowed.",
  ],
  [
    /ratio|source amount|destination amount/i,
    "Conversion ratio between the source and destination point types.",
  ],
  [
    /pair limit/i,
    "Maximum value one giver may send to the same recipient during the configured period.",
  ],
  [/recipient/i, "The member who receives the configured destination point type."],
  [
    /message/i,
    "Explanation shown with the transaction; it may be required for recognition Give operations.",
  ],
  [/category/i, "A reporting label used to group rewards, recognition or transactions."],
  [/primary/i, "The default point type used when an integration does not explicitly provide one."],
  [
    /member profile|show.*profile/i,
    "Controls whether this point type appears in member-facing balance views.",
  ],
  [
    /zero balance/i,
    "Controls whether a visible wallet is shown before the member has received any value.",
  ],
  [
    /negative balance/i,
    "Allows a wallet to go below zero. Keep disabled unless the business process explicitly supports debt.",
  ],
  [
    /manual adjustment/i,
    "Allows authorized operators to add or remove value manually with a mandatory reason and audit entry.",
  ],
  [/bank/i, "The centrally funded pool used to govern issuance for this point type."],
  [
    /give/i,
    "Member-to-member transfer or recognition governed by the configured transfer matrix and limits.",
  ],
  [/redeem/i, "Allows this point type to pay for configured rewards."],
  [
    /exchange|payout/i,
    "Allows conversion through a versioned exchange rate, optionally into a cash payout.",
  ],
  [/cash/i, "Permits a cash payout. This can only be enabled when exchange is enabled."],
  [
    /balance|amount|points|cost|value/i,
    "The integer quantity applied to this wallet or operation.",
  ],
  [
    /reason|description|note/i,
    "Human-readable context retained for users, reporting and audit review.",
  ],
  [
    /status|active/i,
    "Controls whether this item can currently be used. Historical records remain available when inactive.",
  ],
  [/role|permission/i, "Determines which administrative actions this user can view or perform."],
  [
    /email/i,
    "The member or administrator email address used for identification and communication.",
  ],
  [/phone/i, "The contact telephone number stored on the member profile."],
  [/first name/i, "The member’s given name shown in profile and recognition views."],
  [/last name/i, "The member’s family name shown in profile and recognition views."],
  [
    /department/i,
    "The organizational department used for profile display, filtering and reporting.",
  ],
  [/locale|language/i, "The language used for this user’s interface and localized notifications."],
  [/date|start|end/i, "The effective date or time boundary for this configuration."],
  [/name|title/i, "The human-readable name shown to administrators and members."],
];

function definitionFor(label: string): string {
  const clean = label.replace(/\s+/g, " ").replace(/\?$/, "").trim();
  const matched = FIELD_DEFINITIONS.find(([pattern]) => pattern.test(clean));
  return matched?.[1] ?? `Defines how “${clean || "this field"}” is used by this configuration.`;
}

function associatedLabel(control: HTMLElement): HTMLLabelElement | null {
  const closest = control.closest("label");
  if (closest instanceof HTMLLabelElement) return closest;
  if (!control.id) return null;
  return (
    Array.from(document.querySelectorAll("label")).find(
      (candidate) => candidate.htmlFor === control.id,
    ) ?? null
  );
}

function attachHelp(control: HTMLElement): void {
  if (control.dataset.fieldHelpAttached === "true") return;
  control.dataset.fieldHelpAttached = "true";
  const label = associatedLabel(control);
  const explicit = control.dataset.help ?? label?.dataset.help;
  const labelText =
    explicit ??
    label?.textContent ??
    control.getAttribute("aria-label") ??
    control.getAttribute("placeholder") ??
    control.getAttribute("name") ??
    "this field";
  const description = explicit ?? definitionFor(labelText);
  const marker = document.createElement("span");
  marker.className = "auto-field-help";
  marker.dataset.autoFieldHelp = "true";
  marker.tabIndex = 0;
  marker.setAttribute("aria-label", `Help: ${labelText.trim()}`);
  marker.innerHTML = `<span aria-hidden="true">?</span><span class="auto-field-help__tooltip" role="tooltip"></span>`;
  const tooltip = marker.querySelector<HTMLElement>(".auto-field-help__tooltip");
  if (tooltip) tooltip.textContent = description;
  marker.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  (label ?? control.parentElement)?.insertBefore(marker, label ? null : control);
}

function scanFields(): void {
  document
    .querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="switch"], [role="checkbox"], [role="radio"]',
    )
    .forEach(attachHelp);
}

/** Guarantees a keyboard-accessible ? definition beside every form control, including dynamic fields. */
export function AutoFieldHelp(): null {
  useEffect(() => {
    let queued = false;
    const scheduleScan = (): void => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        scanFields();
      });
    };
    scanFields();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll("[data-auto-field-help]").forEach((node) => {
        node.remove();
      });
      document.querySelectorAll<HTMLElement>("[data-field-help-attached]").forEach((node) => {
        delete node.dataset.fieldHelpAttached;
      });
    };
  }, []);
  return null;
}

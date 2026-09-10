import { useEffect } from "react";

const DEFINITIONS: [RegExp, string][] = [
  [
    /wallet|point type|credit type/i,
    "The balance type used for this action. Its expiry, transfer and redemption rules are configured by the program administrator.",
  ],
  [/recipient/i, "The member who will receive the selected destination point type."],
  [/message/i, "Context shown to the recipient and retained with the recognition transaction."],
  [/category/i, "A label that groups this recognition for reporting."],
  [/amount|points|value/i, "The number of points or credits used for this action."],
  [
    /exchange|payout/i,
    "How eligible wallet value will be converted using the active exchange rate.",
  ],
  [/language|locale/i, "The language used by the portal and supported notifications."],
  [/email/i, "The email address used to identify and contact you."],
  [/first name/i, "Your given name shown in your profile and recognition activity."],
  [/last name/i, "Your family name shown in your profile and recognition activity."],
  [/department/i, "Your organizational department shown on your profile."],
  [/photo/i, "An optional image URL used for your profile picture."],
  [/notification/i, "Controls whether this notification channel or topic is enabled for you."],
  [/reward/i, "The reward option and eligible point type used for redemption."],
];

function labelFor(control: HTMLElement): HTMLLabelElement | null {
  const closest = control.closest("label");
  if (closest instanceof HTMLLabelElement) return closest;
  if (!control.id) return null;
  return (
    Array.from(document.querySelectorAll("label")).find(
      (candidate) => candidate.htmlFor === control.id,
    ) ?? null
  );
}

function attach(control: HTMLElement): void {
  if (control.dataset.fieldHelpAttached === "true") return;
  control.dataset.fieldHelpAttached = "true";
  const label = labelFor(control);
  const raw =
    control.dataset.help ??
    label?.dataset.help ??
    label?.textContent ??
    control.getAttribute("aria-label") ??
    control.getAttribute("placeholder") ??
    control.getAttribute("name") ??
    "this field";
  const clean = raw.replace(/\s+/g, " ").replace(/\?$/, "").trim();
  const description =
    control.dataset.help ??
    label?.dataset.help ??
    DEFINITIONS.find(([pattern]) => pattern.test(clean))?.[1] ??
    `Defines how “${clean || "this field"}” is used for this action.`;
  const marker = document.createElement("span");
  marker.className = "auto-field-help";
  marker.dataset.autoFieldHelp = "true";
  marker.tabIndex = 0;
  marker.setAttribute("aria-label", `Help: ${clean}`);
  marker.innerHTML =
    '<span aria-hidden="true">?</span><span class="auto-field-help__tooltip" role="tooltip"></span>';
  const tooltip = marker.querySelector<HTMLElement>(".auto-field-help__tooltip");
  if (tooltip) tooltip.textContent = description;
  marker.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  if (label?.parentElement) {
    const wrapper = document.createElement("span");
    wrapper.className = "auto-field-help-wrapper";
    wrapper.dataset.autoFieldHelpWrapper = "true";
    label.parentElement.insertBefore(wrapper, label);
    wrapper.append(label, marker);
  } else {
    control.parentElement?.insertBefore(marker, control);
  }
}

function scan(): void {
  document
    .querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="switch"], [role="checkbox"], [role="radio"]',
    )
    .forEach(attach);
}

export function AutoFieldHelp(): null {
  useEffect(() => {
    let queued = false;
    const schedule = (): void => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        scan();
      });
    };
    scan();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll("[data-auto-field-help]").forEach((node) => {
        node.remove();
      });
      document.querySelectorAll("[data-auto-field-help-wrapper]").forEach((node) => {
        const parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
      });
      document.querySelectorAll<HTMLElement>("[data-field-help-attached]").forEach((node) => {
        delete node.dataset.fieldHelpAttached;
      });
    };
  }, []);
  return null;
}

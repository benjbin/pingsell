# Pingsell for PrestaShop

Version 1.3.0 · PrestaShop 1.7.0 to 9.x · License AFL-3.0

Pingsell sends the right emails automatically. This module sends your shop's sign-ups, abandoned carts,
orders and shipments to your Pingsell account. No code is needed.

## Installation

1. In your back office, open **Modules > Module Manager > Upload a module** and upload `pingsell.zip`.
2. Click **Configure** on the Pingsell module.
3. Click **Connect to Pingsell**. Sign in to Pingsell (or create an account), check the shop shown and click
   **Link the shop**. You come back to the module page, connected.

That's it: an API key is created for your shop and stored by the module. It is never shown again in full.

### Manual connection

If the button cannot be used (for example a back office on a different domain from the shop), open the
**Manual connection** section, paste the API address and an API key created in Pingsell
(*Integrations > PrestaShop*), then click **Save and test**.

### Disconnect

Click **Disconnect** on the module page. The key is removed from your shop; you can also revoke it in Pingsell.

## What is sent

Each type of data can be switched off in the module settings.

| Setting | Sent when | Data |
| --- | --- | --- |
| New accounts and newsletter sign-ups | a customer creates an account with the newsletter box ticked, or subscribes to the newsletter | email, first and last name, tags |
| Abandoned carts | a logged-in customer's cart changes | email, name, cart products, total, currency, cart link |
| Orders | an order is validated (not cancelled or in payment error) | email, name, phone, reference, products, total, currency |
| Shipped orders | an order gets a shipped status or a tracking number | email, order reference, tracking number and link, carrier |
| Signup form above the footer | (off by default) shows the Pingsell signup form | — |
| Visitor tracking | (off by default) pages and products viewed, logged-in customers recognised | page address, products, email of logged-in customers |

Events are sent after the page has been delivered to the visitor, with a 2-second timeout: your shop never
waits for Pingsell.

### Visitor tracking and cookies

Visitor tracking is **off** after installation. It uses a cookie: switch it on only if your cookie banner
collects your visitors' consent, as required by the GDPR. Upgrading the module never changes this setting.

The tracking script is always loaded from the Pingsell API address, never from another host.

## Advanced settings

Two configuration values are not shown in the settings and can only be changed by code or SQL
(`ps_configuration` table):

- `PINGSELL_APP_URL`: address of the Pingsell web app (default `https://app.pingsell.neokrome.tech`).
- `PINGSELL_API_URL`: address of the Pingsell API, without `/api/v1` (default: `PINGSELL_APP_URL`).

## Uninstall

Uninstalling the module removes all its settings, including the API key.

## Support

https://app.pingsell.neokrome.tech

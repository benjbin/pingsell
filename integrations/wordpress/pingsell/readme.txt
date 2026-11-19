=== Pingsell ===
Contributors: pingsell
Tags: woocommerce, email marketing, abandoned cart, newsletter, automation
Requires at least: 5.8
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Sends your WordPress and WooCommerce sign-ups, carts, orders and shipments to Pingsell, which emails your customers at the right time.

== Description ==

Pingsell is an email marketing service. This plugin connects your site to your Pingsell account in one click, with no code:

* New customer accounts become Pingsell contacts (tag "compte-client").
* WooCommerce abandoned carts, including guests (the email is captured as soon as it is typed at checkout, when visit tracking is enabled).
* Orders ("Processing" or "On hold") start your "Order placed" automations.
* "Completed" orders start "Order shipped", with the tracking number (Shipment Tracking, Advanced Shipment Tracking).
* Contact Form 7, WPForms, Gravity Forms, Elementor Pro and Fluent Forms submissions (option).
* A ready-made signup form: [pingsell_form].
* Visit tracking: pages and products viewed, logged-in customers and buyers recognised, for "Product viewed without purchase" emails (option, off by default).

Events are sent in the background: your shop never waits for Pingsell, even when it cannot be reached.

The plugin is translated into French.

== External services ==

This plugin connects to Pingsell (https://app.pingsell.neokrome.tech), an email marketing service, to send it the events of your shop. Nothing is sent before you connect your site (button "Connect to Pingsell" or manual connection), and each kind of data can be switched off in Settings › Pingsell.

* Connection: when you click "Connect to Pingsell", your browser opens the Pingsell sign-in page with your site address and the address of this settings page. On your return, your site sends the single-use code it received and its address to Pingsell, which answers with an API key for your account.
* Customer accounts (option "New customer accounts"): email, first name and last name of each new account, when it is created.
* Carts and orders (WooCommerce options): customer email, name, phone, order or cart number, items (name, quantity, price), total, currency and cart or payment link, when a cart changes, an order is placed or its status changes. Shipments add the carrier and tracking number.
* Forms (option, off by default): the fields submitted in the supported form plugins, when a form is sent.
* Visit tracking (option, off by default): when enabled, the Pingsell script is loaded from the Pingsell API on your pages and records the pages and products viewed and, for logged-in customers and buyers, their email address. With the WP Consent API, it only runs after the visitor agrees (statistics, and marketing for the email address). Enable it only if your cookie banner collects your visitors' consent.
* Signup form ([pingsell_form]): the Pingsell script is loaded on the page that shows the form, and the visitor's answers are sent to Pingsell when they submit it.
* Test: the button "Test the connection" asks Pingsell for your account details.

Terms of service: https://app.pingsell.neokrome.tech/conditions
Privacy policy: https://app.pingsell.neokrome.tech/confidentialite

== Installation ==

1. In your WordPress admin, go to Plugins › Add New, search for "Pingsell" (or click "Upload Plugin" and choose pingsell.zip), then click Install Now and Activate.
2. Go to Settings › Pingsell and click "Connect to Pingsell".
3. Sign in to Pingsell (or create your account), then click "Connect the store". You are back in WordPress, connected.

If the button cannot be used, open "Manual connection" on the same page and paste an API key from Pingsell › Integrations › WordPress.

== Frequently Asked Questions ==

= Does the plugin slow my shop down? =

No. Events are queued with Action Scheduler (shipped with WooCommerce) or sent without waiting for an answer, and calls made during a page use short timeouts with failures cached.

= Is visit tracking enabled automatically? =

No. On a new installation it is off. Sites that already used it before version 1.3.0 keep it.

= Are abandoned carts of guests captured? =

Carts of logged-in customers are always sent (option "WooCommerce abandoned carts"). For guests, the email typed at checkout is an identification of the visitor: it is only captured when visit tracking is enabled too (and, with the WP Consent API, after marketing consent).

== Changelog ==

= 1.3.0 =
* "Connect to Pingsell" button: sign in, approve, done. The manual connection is still available.
* Visit tracking is now off by default on new installations (unchanged for sites already using it), and follows the WP Consent API.
* The API key is no longer shown in full.
* The checkout email capture is limited per visitor and only runs with visit tracking enabled.
* The tracking script only loads from the Pingsell API.
* Translations: English texts with a French translation.
* Tested with WordPress 6.8 and WooCommerce 10.3.

= 1.2.0 =
* Visit tracking on every page: pages and products viewed, logged-in customers and buyers recognised automatically.

= 1.1.0 =
* Background sending (Action Scheduler): the shop never waits for Pingsell.
* A cart that becomes an order keeps the same number: no double reminder.
* Names read correctly (WPForms, Gravity Forms, Fluent Forms, block checkout).
* Block checkout compatibility declared.

= 1.0.0 =
* First release.

== Upgrade Notice ==

= 1.3.0 =
One-click "Connect to Pingsell" button. Visit tracking stays as you set it.

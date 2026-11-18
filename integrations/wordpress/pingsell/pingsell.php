<?php
/**
 * Plugin Name:       Pingsell
 * Plugin URI:        https://pingsell.neokrome.tech
 * Description:       Connecte WordPress et WooCommerce à Pingsell : inscriptions, paniers abandonnés, commandes, expéditions, formulaires et suivi des visites, sans code.
 * Version:           1.2.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Pingsell
 * License:           GPL-2.0-or-later
 * Text Domain:       pingsell
 * WC requires at least: 6.0
 * WC tested up to:   9.4
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PINGSELL_VERSION', '1.2.0');

final class Pingsell_Plugin
{
    const OPTION = 'pingsell_settings';

    /** @var Pingsell_Plugin|null */
    private static $instance = null;

    public static function instance()
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action('admin_menu', array($this, 'admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('admin_post_pingsell_test', array($this, 'handle_test'));
        add_filter('plugin_action_links_' . plugin_basename(__FILE__), array($this, 'action_links'));

        // WordPress accounts.
        add_action('user_register', array($this, 'on_user_register'), 20, 2);
        // Sends go through Action Scheduler (shipped with WooCommerce) when present: never during the visitor's page.
        add_action('pingsell_send', array($this, 'deliver'), 10, 1);
        add_action('pingsell_send_form', array($this, 'deliver_form'), 10, 2);

        // WooCommerce.
        add_action('woocommerce_order_status_changed', array($this, 'on_order_status'), 20, 4);
        add_action('woocommerce_checkout_order_processed', array($this, 'on_checkout_processed'), 20, 1);
        add_action('woocommerce_store_api_checkout_order_processed', array($this, 'on_checkout_processed'), 20, 1);
        add_action('woocommerce_cart_updated', array($this, 'on_cart_updated'), 20);
        add_action('wp_enqueue_scripts', array($this, 'checkout_capture_script'));
        // Site tracking: the Pingsell script on every page (pages and products seen, customers recognised).
        add_action('wp_enqueue_scripts', array($this, 'tracking_script'));
        add_action('wp_ajax_pingsell_capture', array($this, 'ajax_capture'));
        add_action('wp_ajax_nopriv_pingsell_capture', array($this, 'ajax_capture'));
        add_action('before_woocommerce_init', array($this, 'declare_hpos'));

        // Form plugins (off unless enabled in the settings).
        add_action('wpcf7_mail_sent', array($this, 'on_cf7'), 20, 1);
        add_action('wpforms_process_complete', array($this, 'on_wpforms'), 20, 4);
        add_action('gform_after_submission', array($this, 'on_gravity'), 20, 2);
        add_action('elementor_pro/forms/new_record', array($this, 'on_elementor'), 20, 2);
        add_action('fluentform/submission_inserted', array($this, 'on_fluent'), 20, 3);

        // Signup form anywhere: [pingsell_form title="…" tags="…"] or the « Pingsell » widget.
        add_shortcode('pingsell_form', array($this, 'shortcode'));
    }

    // ─── Settings ─────────────────────────────────────────────────────────────

    public static function defaults()
    {
        return array(
            'api_url'    => '',
            'api_key'    => '',
            'signups'    => '1',
            'carts'      => '1',
            'orders'     => '1',
            'shipments'  => '1',
            'forms'      => '0',
            'tracking'   => '1',
            'form_tags'  => 'formulaire',
        );
    }

    public function settings()
    {
        $saved = get_option(self::OPTION, array());
        return wp_parse_args(is_array($saved) ? $saved : array(), self::defaults());
    }

    private function enabled($key)
    {
        $s = $this->settings();
        return !empty($s['api_key']) && !empty($s['api_url']) && $s[$key] === '1';
    }

    public function admin_menu()
    {
        add_options_page('Pingsell', 'Pingsell', 'manage_options', 'pingsell', array($this, 'settings_page'));
    }

    public function action_links($links)
    {
        array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=pingsell')) . '">' . esc_html__('Réglages', 'pingsell') . '</a>');
        return $links;
    }

    public function register_settings()
    {
        register_setting('pingsell', self::OPTION, array('sanitize_callback' => array($this, 'sanitize')));
    }

    public function sanitize($input)
    {
        $out = self::defaults();
        $input = is_array($input) ? $input : array();
        $out['api_url'] = esc_url_raw(untrailingslashit(trim(isset($input['api_url']) ? $input['api_url'] : '')));
        // Accept the address with or without /api/v1.
        $out['api_url'] = preg_replace('#/api/v1/?$#', '', $out['api_url']);
        $out['api_key'] = sanitize_text_field(isset($input['api_key']) ? trim($input['api_key']) : '');
        foreach (array('signups', 'carts', 'orders', 'shipments', 'forms', 'tracking') as $k) {
            $out[$k] = !empty($input[$k]) ? '1' : '0';
        }
        $out['form_tags'] = sanitize_text_field(isset($input['form_tags']) ? $input['form_tags'] : '');
        delete_transient('pingsell_inbound');
        return $out;
    }

    public function settings_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = $this->settings();
        $woo = class_exists('WooCommerce');
        $status = isset($_GET['pingsell_test']) ? sanitize_key(wp_unslash($_GET['pingsell_test'])) : '';
        ?>
        <div class="wrap">
            <h1>Pingsell</h1>
            <p><?php echo esc_html__('Collez l’adresse de l’API et votre clé API (Pingsell › Intégrations › WordPress). Tout le reste est automatique.', 'pingsell'); ?></p>
            <?php if ($status === 'ok') : ?>
                <div class="notice notice-success"><p><?php echo esc_html__('Connexion réussie : votre site est relié à Pingsell.', 'pingsell'); ?></p></div>
            <?php elseif ($status !== '') : ?>
                <div class="notice notice-error"><p><?php echo esc_html(get_transient('pingsell_test_error') ?: __('Connexion impossible : vérifiez l’adresse et la clé.', 'pingsell')); ?></p></div>
            <?php endif; ?>
            <form method="post" action="options.php">
                <?php settings_fields('pingsell'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="pingsell_api_url"><?php echo esc_html__('Adresse de l’API', 'pingsell'); ?></label></th>
                        <td><input id="pingsell_api_url" class="regular-text" type="url" name="<?php echo esc_attr(self::OPTION); ?>[api_url]" value="<?php echo esc_attr($s['api_url']); ?>" placeholder="https://app.pingsell.neokrome.tech"></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="pingsell_api_key"><?php echo esc_html__('Clé API', 'pingsell'); ?></label></th>
                        <td><input id="pingsell_api_key" class="regular-text code" type="password" autocomplete="off" name="<?php echo esc_attr(self::OPTION); ?>[api_key]" value="<?php echo esc_attr($s['api_key']); ?>" placeholder="msv_…"></td>
                    </tr>
                    <tr>
                        <th scope="row"><?php echo esc_html__('Envoyer à Pingsell', 'pingsell'); ?></th>
                        <td>
                            <?php
                            $boxes = array(
                                'signups'   => __('Nouveaux comptes clients (inscription)', 'pingsell'),
                                'carts'     => __('Paniers abandonnés WooCommerce', 'pingsell'),
                                'orders'    => __('Commandes WooCommerce', 'pingsell'),
                                'shipments' => __('Commandes expédiées (statut « Terminée »)', 'pingsell'),
                                'forms'     => __('Formulaires du site (Contact Form 7, WPForms, Gravity Forms, Elementor, Fluent Forms)', 'pingsell'),
                                'tracking'  => __('Suivi des visites : pages et produits vus, clients reconnus (pour « Produit consulté sans achat »)', 'pingsell'),
                            );
                            foreach ($boxes as $key => $label) {
                                $disabled = !$woo && in_array($key, array('carts', 'orders', 'shipments'), true);
                                printf(
                                    '<label style="display:block;margin:0 0 8px"><input type="checkbox" name="%1$s[%2$s]" value="1" %3$s %4$s> %5$s%6$s</label>',
                                    esc_attr(self::OPTION),
                                    esc_attr($key),
                                    checked($s[$key], '1', false),
                                    disabled($disabled, true, false),
                                    esc_html($label),
                                    $disabled ? ' <em>(' . esc_html__('WooCommerce non installé', 'pingsell') . ')</em>' : ''
                                );
                            }
                            ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="pingsell_form_tags"><?php echo esc_html__('Tags des formulaires', 'pingsell'); ?></label></th>
                        <td><input id="pingsell_form_tags" class="regular-text" type="text" name="<?php echo esc_attr(self::OPTION); ?>[form_tags]" value="<?php echo esc_attr($s['form_tags']); ?>">
                            <p class="description"><?php echo esc_html__('Séparés par des virgules. Le nom du formulaire est ajouté automatiquement.', 'pingsell'); ?></p></td>
                    </tr>
                </table>
                <?php submit_button(__('Enregistrer', 'pingsell')); ?>
            </form>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="pingsell_test">
                <?php wp_nonce_field('pingsell_test'); ?>
                <?php submit_button(__('Tester la connexion', 'pingsell'), 'secondary', 'submit', false); ?>
            </form>
            <h2><?php echo esc_html__('Formulaire d’inscription', 'pingsell'); ?></h2>
            <p><?php echo wp_kses_post(__('Ajoutez <code>[pingsell_form]</code> dans une page, un article ou un bloc « Code court ». Options : <code>title</code>, <code>text</code>, <code>button</code>, <code>tags</code>, <code>fields="first_name,email"</code>, <code>color="#145CFF"</code>.', 'pingsell')); ?></p>
        </div>
        <?php
    }

    public function handle_test()
    {
        if (!current_user_can('manage_options') || !check_admin_referer('pingsell_test')) {
            wp_die(esc_html__('Action non autorisée.', 'pingsell'));
        }
        $res = $this->request('GET', '/me', null, true);
        $ok = !is_wp_error($res) && wp_remote_retrieve_response_code($res) === 200;
        if (!$ok) {
            $msg = is_wp_error($res) ? $res->get_error_message() : wp_remote_retrieve_body($res);
            $json = json_decode((string) $msg, true);
            set_transient('pingsell_test_error', is_array($json) && isset($json['error']) ? $json['error'] : (string) $msg, 60);
        }
        wp_safe_redirect(admin_url('options-general.php?page=pingsell&pingsell_test=' . ($ok ? 'ok' : 'error')));
        exit;
    }

    // ─── Transport ────────────────────────────────────────────────────────────

    /**
     * @param string     $method
     * @param string     $path     e.g. /events
     * @param array|null $body
     * @param bool       $blocking false = fire and forget (never slows the shop down)
     */
    private function request($method, $path, $body = null, $blocking = false)
    {
        $s = $this->settings();
        if (empty($s['api_url']) || empty($s['api_key'])) {
            return new WP_Error('pingsell_not_configured', __('Pingsell n’est pas configuré.', 'pingsell'));
        }
        $args = array(
            'method'   => $method,
            'timeout'  => $blocking ? 10 : 1,
            'blocking' => $blocking,
            'headers'  => array(
                'Authorization'     => 'Bearer ' . $s['api_key'],
                'Content-Type'      => 'application/json',
                'Accept-Language'   => 'fr',
                'X-Pingsell-Source' => 'wordpress',
                'User-Agent'        => 'Pingsell-WordPress/' . PINGSELL_VERSION,
            ),
        );
        if ($body !== null) {
            $args['body'] = wp_json_encode($body);
        }
        return wp_remote_request($s['api_url'] . '/api/v1' . $path, $args);
    }

    /** One event: see « Un seul appel » in Pingsell › Intégrations. */
    public function send_event($event, array $data)
    {
        if (empty($data['email']) || !is_email($data['email'])) {
            return;
        }
        $data = array_filter(array_merge(array('event' => $event), $data), function ($v) {
            return $v !== null && $v !== '' && $v !== array();
        });
        if (function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action('pingsell_send', array($data), 'pingsell');
            return;
        }
        $this->request('POST', '/events', $data, false);
    }

    /** Action Scheduler job: the real (waiting) call, retried by the scheduler on failure. */
    public function deliver($data)
    {
        if (is_array($data)) {
            $this->request('POST', '/events', $data, true);
        }
    }

    // ─── WordPress accounts ───────────────────────────────────────────────────

    public function on_user_register($user_id, $userdata = array())
    {
        if (!$this->enabled('signups')) {
            return;
        }
        $user = get_userdata($user_id);
        if (!$user) {
            return;
        }
        // WordPress 5.8+ passes the submitted data: names are not saved as meta yet at this point.
        $first = !empty($userdata['first_name']) ? $userdata['first_name'] : get_user_meta($user_id, 'first_name', true);
        $last = !empty($userdata['last_name']) ? $userdata['last_name'] : get_user_meta($user_id, 'last_name', true);
        // WooCommerce checkout registers the account before filling the names: read them from the form.
        if (!$first && isset($_POST['billing_first_name'])) {
            $first = sanitize_text_field(wp_unslash($_POST['billing_first_name']));
        }
        if (!$last && isset($_POST['billing_last_name'])) {
            $last = sanitize_text_field(wp_unslash($_POST['billing_last_name']));
        }
        $this->send_event('inscription', array(
            'email'      => $user->user_email,
            'first_name' => $first,
            'last_name'  => $last,
            'tags'       => array('compte-client'),
        ));
    }

    // ─── WooCommerce ──────────────────────────────────────────────────────────

    public function declare_hpos()
    {
        if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', __FILE__, true);
            \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', __FILE__, true);
        }
    }

    /** @param WC_Order $order */
    private function order_payload($order)
    {
        $items = array();
        foreach ($order->get_items() as $item) {
            $qty = max(1, (int) $item->get_quantity());
            $items[] = array(
                'title'    => mb_substr($item->get_name(), 0, 200),
                'quantity' => $qty,
                'price'    => round((float) $order->get_item_total($item, true), 2),
            );
            if (count($items) >= 50) {
                break;
            }
        }
        return array(
            'email'      => $order->get_billing_email(),
            'first_name' => $order->get_billing_first_name(),
            'last_name'  => $order->get_billing_last_name(),
            'phone'      => $order->get_billing_phone(),
            'id'         => (string) $order->get_order_number(),
            'total'      => round((float) $order->get_total(), 2),
            'currency'   => $order->get_currency(),
            'items'      => $items,
        );
    }

    /** Shipment Tracking (official), Advanced Shipment Tracking, or plain order meta. */
    private function tracking($order)
    {
        $items = $order->get_meta('_wc_shipment_tracking_items');
        if (is_array($items) && !empty($items[0])) {
            $t = $items[0];
            return array(
                'tracking_number' => isset($t['tracking_number']) ? $t['tracking_number'] : null,
                'carrier'         => !empty($t['tracking_provider']) ? $t['tracking_provider'] : (isset($t['custom_tracking_provider']) ? $t['custom_tracking_provider'] : null),
                'tracking_url'    => isset($t['custom_tracking_link']) ? $t['custom_tracking_link'] : null,
            );
        }
        $number = $order->get_meta('_tracking_number');
        return array('tracking_number' => $number ? (string) $number : null);
    }

    public function on_checkout_processed($order)
    {
        $order = is_numeric($order) ? wc_get_order($order) : $order;
        if (!$order || !is_a($order, 'WC_Order')) {
            return;
        }
        // The cart followed while browsing becomes this order: same id, so it is not relaunched twice.
        if (function_exists('WC') && WC()->session) {
            $cart_id = WC()->session->get('pingsell_cart_id');
            if ($cart_id) {
                $order->update_meta_data('_pingsell_cart_id', $cart_id);
                $order->save_meta_data();
                WC()->session->set('pingsell_cart_id', null);
            }
        }
        // Not paid yet (card declined, redirect to the bank…): a cart to relaunch with its payment link.
        if (in_array($order->get_status(), array('pending', 'failed'), true) && $this->enabled('carts')) {
            $this->send_event('panier', $this->order_cart($order));
        }
    }

    /** The unpaid order as a « panier » (payment link), under the id of the cart it came from. */
    private function order_cart($order)
    {
        $data = $this->order_payload($order);
        $cart_id = $order->get_meta('_pingsell_cart_id');
        if ($cart_id) {
            $data['id'] = (string) $cart_id;
        }
        $data['url'] = $order->get_checkout_payment_url();
        return $data;
    }

    public function on_order_status($order_id, $from, $to, $order = null)
    {
        $order = $order ? $order : wc_get_order($order_id);
        if (!$order) {
            return;
        }
        $data = $this->order_payload($order);
        if (in_array($to, array('processing', 'on-hold'), true) && $this->enabled('orders')) {
            $this->send_event('commande', $data);
        } elseif ($to === 'completed') {
            // Sent as an order too (deduplicated by id) so the shipment always finds its customer —
            // but not when it already went through « En cours » (an old order closed later gets no late thank-you).
            if ($this->enabled('orders') && !in_array($from, array('processing', 'on-hold'), true)) {
                $this->send_event('commande', $data);
            }
            if ($this->enabled('shipments')) {
                $this->send_event('expedition', array_merge(array('email' => $data['email'], 'id' => $data['id']), $this->tracking($order)));
            }
        } elseif ($to === 'failed' && $this->enabled('carts')) {
            $this->send_event('panier', $this->order_cart($order));
        }
    }

    /** The visitor's cart as a Pingsell « panier »: sent each time it changes once we know their email. */
    private function send_cart($email, $first = '', $last = '')
    {
        if (!function_exists('WC') || !WC()->cart || !WC()->session) {
            return;
        }
        $cart = WC()->cart;
        if ($cart->is_empty()) {
            return;
        }
        $items = array();
        foreach ($cart->get_cart() as $line) {
            $product = isset($line['data']) ? $line['data'] : null;
            if (!$product) {
                continue;
            }
            $items[] = array(
                'title'    => mb_substr($product->get_name(), 0, 200),
                'quantity' => max(1, (int) $line['quantity']),
                'price'    => round((float) wc_get_price_including_tax($product), 2),
            );
        }
        $id = WC()->session->get('pingsell_cart_id');
        if (!$id) {
            $id = 'wc-' . wp_generate_password(16, false, false);
            WC()->session->set('pingsell_cart_id', $id);
        }
        $this->send_event('panier', array(
            'email'      => $email,
            'first_name' => $first,
            'last_name'  => $last,
            'id'         => $id,
            'total'      => round((float) $cart->get_total('edit'), 2),
            'currency'   => get_woocommerce_currency(),
            'url'        => wc_get_cart_url(),
            'items'      => array_slice($items, 0, 50),
        ));
    }

    public function on_cart_updated()
    {
        if (!$this->enabled('carts') || !is_user_logged_in()) {
            return;
        }
        // Once per request is enough (the hook fires for each line).
        static $done = false;
        if ($done) {
            return;
        }
        $done = true;
        $user = wp_get_current_user();
        add_action('shutdown', function () use ($user) {
            $this->send_cart($user->user_email, $user->first_name, $user->last_name);
        });
    }

    /** The Pingsell script on every page; logged-in customers and the buyer on « Commande reçue » are recognised. */
    public function tracking_script()
    {
        if (!$this->enabled('tracking') || is_admin()) {
            return;
        }
        $inbound = $this->webhook_url();
        if (!$inbound || empty($inbound['form']['script_url'])) {
            return;
        }
        wp_enqueue_script('pingsell-form', $inbound['form']['script_url'], array(), null, array('strategy' => 'async', 'in_footer' => false));
        $email = '';
        if (is_user_logged_in()) {
            $email = wp_get_current_user()->user_email;
        } elseif (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-received') && function_exists('wc_get_order')) {
            global $wp;
            $order = wc_get_order(absint(isset($wp->query_vars['order-received']) ? $wp->query_vars['order-received'] : 0));
            $key = isset($_GET['key']) ? sanitize_text_field(wp_unslash($_GET['key'])) : '';
            if ($order && $key !== '' && hash_equals((string) $order->get_order_key(), $key)) {
                $email = $order->get_billing_email();
            }
        }
        if ($email && is_email($email)) {
            wp_add_inline_script('pingsell-form', 'window.Pingsell=window.Pingsell||{q:[]};(Pingsell.q=Pingsell.q||[]).push(["identify",' . wp_json_encode($email) . ']);', 'before');
        }
    }

    /** Guests: the email typed at checkout is captured as soon as it is filled in (classic and block checkout). */
    public function checkout_capture_script()
    {
        if (!$this->enabled('carts') || !function_exists('is_checkout') || !is_checkout() || is_wc_endpoint_url('order-received')) {
            return;
        }
        wp_register_script('pingsell-capture', '', array(), PINGSELL_VERSION, true);
        wp_enqueue_script('pingsell-capture');
        wp_add_inline_script('pingsell-capture', sprintf(
            '(function(){var u=%s,n=%s,last="";function v(id){var e=document.getElementById(id);return e?e.value:""}' .
            'function go(){var m=v("billing_email")||v("email"),f=v("billing_first_name")||v("billing-first_name")||v("shipping-first_name"),l=v("billing_last_name")||v("billing-last_name")||v("shipping-last_name"),k=m+"|"+f+"|"+l;' .
            'if(!m||k===last||!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(m))return;last=k;' .
            'var b=new URLSearchParams({action:"pingsell_capture",nonce:n,email:m,first_name:f,last_name:l});' .
            'fetch(u,{method:"POST",credentials:"same-origin",body:b})}' .
            'document.addEventListener("change",function(e){var id=e.target&&e.target.id;if(/email|first|last/.test(id||""))go()},true);setTimeout(go,1500)})();',
            wp_json_encode(admin_url('admin-ajax.php')),
            wp_json_encode(wp_create_nonce('pingsell_capture'))
        ));
    }

    public function ajax_capture()
    {
        check_ajax_referer('pingsell_capture', 'nonce');
        $email = isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '';
        if ($email && is_email($email) && $this->enabled('carts')) {
            $this->send_cart(
                $email,
                isset($_POST['first_name']) ? sanitize_text_field(wp_unslash($_POST['first_name'])) : '',
                isset($_POST['last_name']) ? sanitize_text_field(wp_unslash($_POST['last_name'])) : ''
            );
        }
        wp_send_json_success();
    }

    // ─── Form plugins → universal webhook (field names detected by Pingsell) ───

    private function webhook_url()
    {
        $cached = get_transient('pingsell_inbound');
        if (is_array($cached)) {
            return $cached;
        }
        // A recent failure: don't make every form submission wait for Pingsell again.
        if (get_transient('pingsell_inbound_failed')) {
            return null;
        }
        $s = $this->settings();
        $res = empty($s['api_url']) || empty($s['api_key']) ? null : wp_remote_get($s['api_url'] . '/api/v1/inbound', array(
            'timeout' => 3,
            'headers' => array('Authorization' => 'Bearer ' . $s['api_key'], 'Accept-Language' => 'fr', 'User-Agent' => 'Pingsell-WordPress/' . PINGSELL_VERSION),
        ));
        if (!$res || is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200) {
            set_transient('pingsell_inbound_failed', 1, 10 * MINUTE_IN_SECONDS);
            return null;
        }
        $json = json_decode(wp_remote_retrieve_body($res), true);
        if (!is_array($json)) {
            return null;
        }
        set_transient('pingsell_inbound', $json, DAY_IN_SECONDS);
        return $json;
    }

    private function send_form($form_name, array $fields)
    {
        if (!$this->enabled('forms')) {
            return;
        }
        $inbound = $this->webhook_url();
        if (!$inbound || empty($inbound['webhook']['url'])) {
            return;
        }
        $s = $this->settings();
        $tags = array_filter(array_map('trim', explode(',', $s['form_tags'])));
        if ($form_name) {
            $tags[] = sanitize_title($form_name);
        }
        $tags = array_map(function ($t) {
            return mb_substr($t, 0, 64);
        }, $tags);
        $clean = array();
        foreach ($fields as $k => $v) {
            // Lists (checkboxes) become « A, B »; one level of named nesting is opened
            // (Fluent Forms « names » => first_name / last_name).
            if (is_array($v) && $v === array_values($v)) {
                $v = implode(', ', array_filter($v, 'is_scalar'));
            }
            $pairs = is_array($v) ? $v : array($k => $v);
            foreach ($pairs as $pk => $pv) {
                $pk = (string) $pk;
                if (is_scalar($pv) && $pv !== '' && strpos($pk, '_') !== 0 && !isset($clean[$pk])) {
                    $clean[$pk] = mb_substr((string) $pv, 0, 1000);
                }
            }
        }
        $url = add_query_arg(array('tags' => implode(',', $tags)), $inbound['webhook']['url']);
        if (function_exists('as_enqueue_async_action')) {
            as_enqueue_async_action('pingsell_send_form', array($url, $clean), 'pingsell');
            return;
        }
        wp_remote_post($url, array(
            'timeout'  => 1,
            'blocking' => false,
            'headers'  => array('Content-Type' => 'application/json', 'X-Pingsell-Source' => 'wordpress-form'),
            'body'     => wp_json_encode($clean),
        ));
    }

    /** Action Scheduler job for a form: a 404 means the webhook address was rotated, fetch it again next time. */
    public function deliver_form($url, $fields)
    {
        $res = wp_remote_post($url, array(
            'timeout' => 10,
            'headers' => array('Content-Type' => 'application/json', 'X-Pingsell-Source' => 'wordpress-form'),
            'body'    => wp_json_encode($fields),
        ));
        if (!is_wp_error($res) && wp_remote_retrieve_response_code($res) === 404) {
            delete_transient('pingsell_inbound');
        }
    }

    public function on_cf7($form)
    {
        if (!class_exists('WPCF7_Submission')) {
            return;
        }
        $submission = WPCF7_Submission::get_instance();
        if ($submission) {
            $this->send_form($form->title(), (array) $submission->get_posted_data());
        }
    }

    public function on_wpforms($fields, $entry, $form_data, $entry_id)
    {
        $out = array();
        foreach ((array) $fields as $f) {
            if (isset($f['name'], $f['value'])) {
                if (isset($f['type']) && $f['type'] === 'name' && !empty($f['first'])) {
                    $out['first_name'] = $f['first'];
                    $out['last_name'] = isset($f['last']) ? $f['last'] : '';
                    continue;
                }
                $out[isset($f['type']) && $f['type'] === 'email' && !isset($out['email']) ? 'email' : $f['name']] = $f['value'];
            }
        }
        $this->send_form(isset($form_data['settings']['form_title']) ? $form_data['settings']['form_title'] : 'wpforms', $out);
    }

    public function on_gravity($entry, $form)
    {
        $out = array();
        foreach ((array) $form['fields'] as $field) {
            $label = isset($field->label) ? $field->label : (string) $field->id;
            // Name field: first name in input .3, last name in .6.
            if ($field->type === 'name') {
                $out['first_name'] = rgar($entry, $field->id . '.3');
                $out['last_name'] = rgar($entry, $field->id . '.6');
                continue;
            }
            // Email with confirmation has two inputs: the first one is the address.
            if ($field->type === 'email') {
                $value = rgar($entry, (string) $field->id);
                if ($value !== '' && !isset($out['email'])) {
                    $out['email'] = $value;
                }
                continue;
            }
            if (!empty($field->inputs) && is_array($field->inputs)) {
                foreach ($field->inputs as $input) {
                    $value = rgar($entry, (string) $input['id']);
                    if ($value !== '') {
                        $out[$label . ' ' . $input['label']] = $value;
                    }
                }
            } else {
                $value = rgar($entry, (string) $field->id);
                if ($value !== '') {
                    $out[$field->type === 'email' ? 'email' : $label] = $value;
                }
            }
        }
        $this->send_form(isset($form['title']) ? $form['title'] : 'gravity', $out);
    }

    public function on_elementor($record, $handler)
    {
        $out = array();
        foreach ((array) $record->get('fields') as $id => $field) {
            $key = !empty($field['type']) && $field['type'] === 'email' ? 'email' : (!empty($field['title']) ? $field['title'] : $id);
            $out[$key] = isset($field['value']) ? $field['value'] : '';
        }
        $this->send_form((string) $record->get_form_settings('form_name'), $out);
    }

    public function on_fluent($entry_id, $form_data, $form)
    {
        $this->send_form(isset($form->title) ? $form->title : 'fluentform', (array) $form_data);
    }

    // ─── Shortcode ────────────────────────────────────────────────────────────

    public function shortcode($atts)
    {
        $atts = shortcode_atts(array(
            'title'    => '',
            'text'     => '',
            'button'   => '',
            'tags'     => '',
            'fields'   => '',
            'color'    => '',
            'success'  => '',
            'consent'  => '',
            'redirect' => '',
        ), $atts, 'pingsell_form');
        $inbound = $this->webhook_url();
        if (!$inbound || empty($inbound['form']['script_url'])) {
            return current_user_can('manage_options')
                ? '<p><em>' . esc_html__('Pingsell : renseignez votre clé API dans Réglages › Pingsell pour afficher ce formulaire.', 'pingsell') . '</em></p>'
                : '';
        }
        wp_enqueue_script('pingsell-form', $inbound['form']['script_url'], array(), null, true);
        $data = '';
        foreach ($atts as $k => $v) {
            if ($v !== '') {
                $data .= sprintf(' data-%s="%s"', esc_attr($k), esc_attr($v));
            }
        }
        return '<div data-pingsell-form' . $data . '></div>';
    }
}

Pingsell_Plugin::instance();

<?php
/**
 * Plugin Name:       Pingsell
 * Plugin URI:        https://pingsell.neokrome.tech
 * Description:       Connects WordPress and WooCommerce to Pingsell: sign-ups, abandoned carts, orders, shipments, forms and visit tracking, with no code.
 * Version:           1.3.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Pingsell
 * Author URI:        https://pingsell.neokrome.tech
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       pingsell
 * Domain Path:       /languages
 * WC requires at least: 6.0
 * WC tested up to:   10.3
 *
 * @package Pingsell
 */

if (!defined('ABSPATH')) {
    exit;
}

define('PINGSELL_VERSION', '1.3.0');

// Both addresses can be overridden in wp-config.php (define() before the plugins load).
if (!defined('PINGSELL_APP_URL')) {
    define('PINGSELL_APP_URL', 'https://app.pingsell.neokrome.tech');
}
if (!defined('PINGSELL_API_URL')) {
    define('PINGSELL_API_URL', PINGSELL_APP_URL);
}

final class Pingsell_Plugin
{
    const OPTION = 'pingsell_settings';
    const STATE_OPTION = 'pingsell_connect_state';
    const VERSION_OPTION = 'pingsell_version';
    /** A connection started from the admin must come back within 15 minutes. */
    const STATE_TTL = 900;
    /** Checkout email capture: at most 10 calls per visitor (IP + WooCommerce session) every 10 minutes. */
    const CAPTURE_LIMIT = 10;
    /**
     * And at most 300 calls per IP every 10 minutes: behind a CDN or a reverse proxy all visitors
     * share one IP, so this ceiling only stops a flood, not the shop's customers.
     */
    const CAPTURE_IP_LIMIT = 300;

    // TODO: the terms page https://app.pingsell.neokrome.tech/conditions (linked from readme.txt,
    // « External services ») does not exist yet in apps/web: create it before submitting to wordpress.org.

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
        add_action('init', array($this, 'load_textdomain'));
        add_action('plugins_loaded', array($this, 'maybe_upgrade'));
        add_action('admin_menu', array($this, 'admin_menu'));
        add_action('admin_init', array($this, 'register_settings'));
        add_action('admin_init', array($this, 'handle_connect_return'));
        add_action('admin_enqueue_scripts', array($this, 'admin_scripts'));
        add_action('admin_post_pingsell_connect', array($this, 'handle_connect'));
        add_action('admin_post_pingsell_disconnect', array($this, 'handle_disconnect'));
        add_action('admin_post_pingsell_manual', array($this, 'handle_manual'));
        add_action('admin_post_pingsell_test', array($this, 'handle_test'));
        add_filter('plugin_action_links_' . plugin_basename(__FILE__), array($this, 'action_links'));
        // WP Consent API: this plugin checks consent itself before tracking.
        add_filter('wp_consent_api_registered_' . plugin_basename(__FILE__), '__return_true');

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
        // Site tracking (off unless the merchant enables it): pages and products seen, customers recognised.
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

        // Signup form anywhere: [pingsell_form title="…" tags="…"].
        add_shortcode('pingsell_form', array($this, 'shortcode'));
    }

    public function load_textdomain()
    {
        // The plugin is also distributed outside WordPress.org: its French translation ships in /languages.
        // phpcs:ignore PluginCheck.CodeAnalysis.DiscouragedFunctions.load_plugin_textdomainFound -- bundled translations for the direct download.
        load_plugin_textdomain('pingsell', false, dirname(plugin_basename(__FILE__)) . '/languages');
    }

    // ─── Install / upgrade ────────────────────────────────────────────────────

    /** Fresh install: everything off that needs the merchant's explicit choice (visit tracking). */
    public static function activate()
    {
        if (get_option(self::OPTION, false) === false) {
            add_option(self::OPTION, self::defaults());
        }
        self::instance()->maybe_upgrade();
    }

    /**
     * Before 1.3.0 visit tracking was on by default. A merchant who already uses it keeps it:
     * settings saved without the « tracking » key were tracking, so it is written as « on ».
     */
    public function maybe_upgrade()
    {
        if (get_option(self::VERSION_OPTION) === PINGSELL_VERSION) {
            return;
        }
        $saved = get_option(self::OPTION, false);
        if (is_array($saved) && !array_key_exists('tracking', $saved)) {
            $saved['tracking'] = '1';
            update_option(self::OPTION, $saved);
        }
        update_option(self::VERSION_OPTION, PINGSELL_VERSION);
    }

    // ─── Settings ─────────────────────────────────────────────────────────────

    public static function defaults()
    {
        return array(
            'api_url'      => '',
            'api_key'      => '',
            'account_name' => '',
            'manual'       => '0',
            'signups'      => '1',
            'carts'        => '1',
            'orders'       => '1',
            'shipments'    => '1',
            'forms'        => '0',
            'tracking'     => '0',
            'form_tags'    => 'formulaire',
        );
    }

    private static function checkboxes()
    {
        return array('signups', 'carts', 'orders', 'shipments', 'forms', 'tracking');
    }

    public function settings()
    {
        $saved = get_option(self::OPTION, array());
        return wp_parse_args(is_array($saved) ? $saved : array(), self::defaults());
    }

    /** Base address of the API (without /api/v1): the one received at connection, else PINGSELL_API_URL. */
    private function api_url()
    {
        $s = $this->settings();
        return untrailingslashit($s['api_url'] !== '' ? $s['api_url'] : PINGSELL_API_URL);
    }

    private function connected()
    {
        $s = $this->settings();
        return $s['api_key'] !== '';
    }

    private function enabled($key)
    {
        $s = $this->settings();
        return $this->connected() && $s[$key] === '1';
    }

    private static function is_local_host($host)
    {
        $host = strtolower(trim((string) $host, '[]'));
        return in_array($host, array('localhost', '127.0.0.1', '::1'), true) || (bool) preg_match('/\.(localhost|test)$/', $host);
    }

    /** https, or http on a local address (development). */
    private static function valid_api_url($url)
    {
        $parts = wp_parse_url((string) $url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return false;
        }
        $scheme = strtolower($parts['scheme']);
        return $scheme === 'https' || ($scheme === 'http' && self::is_local_host($parts['host']));
    }

    /** Hosts the plugin accepts scripts and webhooks from: PINGSELL_API_URL and the API it is connected to. */
    private function allowed_hosts()
    {
        $hosts = array();
        foreach (array(PINGSELL_API_URL, $this->api_url()) as $url) {
            $host = wp_parse_url($url, PHP_URL_HOST);
            if ($host) {
                $hosts[] = strtolower($host);
            }
        }
        return array_unique($hosts);
    }

    private function on_allowed_host($url)
    {
        $host = wp_parse_url((string) $url, PHP_URL_HOST);
        return $host && self::valid_api_url($url) && in_array(strtolower($host), $this->allowed_hosts(), true);
    }

    /** « msv_AbCd…wxyz »: the key is never shown again in full. */
    public static function mask_key($key)
    {
        $key = (string) $key;
        if ($key === '') {
            return '';
        }
        if (strlen($key) <= 12) {
            return substr($key, 0, 4) . '…';
        }
        return substr($key, 0, 8) . '…' . substr($key, -4);
    }

    private static function lang()
    {
        return strpos(function_exists('determine_locale') ? determine_locale() : get_locale(), 'fr') === 0 ? 'fr' : 'en';
    }

    private function page_url()
    {
        return admin_url('options-general.php?page=pingsell');
    }

    public function admin_menu()
    {
        add_options_page('Pingsell', 'Pingsell', 'manage_options', 'pingsell', array($this, 'settings_page'));
    }

    public function action_links($links)
    {
        array_unshift($links, '<a href="' . esc_url($this->page_url()) . '">' . esc_html__('Settings', 'pingsell') . '</a>');
        return $links;
    }

    public function register_settings()
    {
        register_setting('pingsell', self::OPTION, array('sanitize_callback' => array($this, 'sanitize')));
    }

    /**
     * Runs on every save of the option (settings form and the plugin's own updates).
     * Only the keys present are changed: the settings form never touches the connection.
     */
    public function sanitize($input)
    {
        $out = $this->settings();
        $input = is_array($input) ? $input : array();
        if (array_key_exists('api_url', $input)) {
            $url = preg_replace('#/api/v1/?$#', '', untrailingslashit(esc_url_raw(trim((string) $input['api_url']))));
            $out['api_url'] = $url !== '' && self::valid_api_url($url) ? $url : '';
        }
        if (array_key_exists('api_key', $input)) {
            $out['api_key'] = sanitize_text_field(trim((string) $input['api_key']));
        }
        if (array_key_exists('account_name', $input)) {
            $out['account_name'] = sanitize_text_field((string) $input['account_name']);
        }
        if (array_key_exists('manual', $input)) {
            $out['manual'] = $input['manual'] === '1' ? '1' : '0';
        }
        foreach (self::checkboxes() as $k) {
            if (array_key_exists($k, $input)) {
                $out[$k] = (string) $input[$k] === '1' ? '1' : '0';
            }
        }
        if (array_key_exists('form_tags', $input)) {
            $out['form_tags'] = sanitize_text_field((string) $input['form_tags']);
        }
        delete_transient('pingsell_inbound');
        delete_transient('pingsell_inbound_failed');
        return $out;
    }

    private function save(array $changes)
    {
        update_option(self::OPTION, array_merge($this->settings(), $changes));
    }

    /** One message shown once on the settings page, for the current user. */
    private function notice($type, $message, $retry = false)
    {
        set_transient('pingsell_notice_' . get_current_user_id(), array('type' => $type, 'message' => $message, 'retry' => $retry), 5 * MINUTE_IN_SECONDS);
    }

    private function back_to_page()
    {
        wp_safe_redirect($this->page_url());
        exit;
    }

    private function check_admin_action($action)
    {
        if (!current_user_can('manage_options') || !check_admin_referer($action)) {
            wp_die(esc_html__('Action not allowed.', 'pingsell'));
        }
    }

    public function admin_scripts($hook)
    {
        if ($hook !== 'settings_page_pingsell') {
            return;
        }
        wp_enqueue_script('pingsell-admin', plugins_url('assets/pingsell-admin.js', __FILE__), array(), PINGSELL_VERSION, true);
    }

    // ─── « Connect to Pingsell » ──────────────────────────────────────────────

    /** Step 1: a fresh state, then the Pingsell page where the merchant signs in and approves. */
    public function handle_connect()
    {
        $this->check_admin_action('pingsell_connect');
        $state = bin2hex(random_bytes(32));
        update_option(self::STATE_OPTION, array('state' => $state, 'time' => time()), false);
        $url = untrailingslashit(PINGSELL_APP_URL) . '/connecter/boutique?' . http_build_query(array(
            'platform'   => 'wordpress',
            'site'       => home_url('/'),
            'return_url' => $this->page_url(),
            'state'      => $state,
        ), '', '&', PHP_QUERY_RFC3986);
        add_filter('allowed_redirect_hosts', array($this, 'allow_app_host'));
        wp_safe_redirect($url);
        exit;
    }

    public function allow_app_host($hosts)
    {
        $host = wp_parse_url(PINGSELL_APP_URL, PHP_URL_HOST);
        if ($host) {
            $hosts[] = $host;
        }
        return $hosts;
    }

    /** Step 2: back from Pingsell with ?pingsell_code=…&state=… (or ?pingsell_error=access_denied). */
    public function handle_connect_return()
    {
        // phpcs:disable WordPress.Security.NonceVerification.Recommended -- coming back from Pingsell: protected by the single-use state (hash_equals) instead of a nonce.
        if (!isset($_GET['page']) || sanitize_key(wp_unslash($_GET['page'])) !== 'pingsell') {
            return;
        }
        if (!isset($_GET['pingsell_code']) && !isset($_GET['pingsell_error'])) {
            return;
        }
        if (!current_user_can('manage_options')) {
            return;
        }
        $code = isset($_GET['pingsell_code']) ? sanitize_text_field(wp_unslash($_GET['pingsell_code'])) : '';
        $state = isset($_GET['state']) ? sanitize_text_field(wp_unslash($_GET['state'])) : '';
        $error = isset($_GET['pingsell_error']) ? sanitize_key(wp_unslash($_GET['pingsell_error'])) : '';
        // phpcs:enable WordPress.Security.NonceVerification.Recommended
        $result = $this->complete_connection($code, $state, $error);
        $this->notice($result['type'], $result['message'], $result['type'] === 'error');
        $this->back_to_page();
    }

    /** @return array{type:string,message:string} */
    public function complete_connection($code, $state, $error = '')
    {
        $pending = get_option(self::STATE_OPTION, false);
        $valid = is_array($pending) && !empty($pending['state']) && is_string($pending['state']) && $state !== ''
            && hash_equals($pending['state'], (string) $state)
            && isset($pending['time']) && time() - (int) $pending['time'] >= 0 && time() - (int) $pending['time'] <= self::STATE_TTL;
        if ($valid || $error !== '') {
            delete_option(self::STATE_OPTION);
        }
        if ($error === 'access_denied') {
            return array('type' => 'warning', 'message' => __('Connection cancelled.', 'pingsell'));
        }
        if ($error !== '' || !$valid || !preg_match('/^[A-Za-z0-9_-]{16,200}$/', (string) $code)) {
            return array('type' => 'error', 'message' => __('This connection link is no longer valid. Start again from this page.', 'pingsell'));
        }

        $res = wp_remote_post(untrailingslashit(PINGSELL_API_URL) . '/api/v1/public/connect/exchange', array(
            'timeout' => 15,
            'headers' => array(
                'Content-Type'    => 'application/json',
                'Accept-Language' => self::lang(),
                'User-Agent'      => 'Pingsell-WordPress/' . PINGSELL_VERSION,
            ),
            'body'    => wp_json_encode(array('code' => $code, 'platform' => 'wordpress', 'site' => home_url('/'))),
        ));
        if (is_wp_error($res)) {
            return array('type' => 'error', 'message' => __('Pingsell could not be reached. Try again in a moment.', 'pingsell'));
        }
        $json = json_decode((string) wp_remote_retrieve_body($res), true);
        if (wp_remote_retrieve_response_code($res) !== 200) {
            $detail = is_array($json) && isset($json['error']) && is_string($json['error']) ? $json['error'] : __('Pingsell returned an unexpected response.', 'pingsell');
            /* translators: %s: error message returned by Pingsell. */
            return array('type' => 'error', 'message' => sprintf(__('The connection failed: %s', 'pingsell'), sanitize_text_field($detail)));
        }
        if (!is_array($json) || empty($json['api_key']) || !is_string($json['api_key']) || !preg_match('/^msv_[A-Za-z0-9_-]{8,}$/', $json['api_key'])) {
            /* translators: %s: error message returned by Pingsell. */
            return array('type' => 'error', 'message' => sprintf(__('The connection failed: %s', 'pingsell'), __('Pingsell returned an unexpected response.', 'pingsell')));
        }
        $api_url = isset($json['api_url']) && is_string($json['api_url']) ? untrailingslashit($json['api_url']) : '';
        $name = isset($json['account_name']) && is_string($json['account_name']) ? sanitize_text_field($json['account_name']) : '';
        $this->save(array(
            'api_key'      => $json['api_key'],
            // Only a secure address (or a local one in development); otherwise the default one.
            'api_url'      => self::valid_api_url($api_url) ? $api_url : '',
            'account_name' => $name,
            'manual'       => '0',
        ));
        delete_transient('pingsell_inbound');
        delete_transient('pingsell_inbound_failed');
        return array('type' => 'success', 'message' => $this->connected_message());
    }

    private function connected_message()
    {
        $s = $this->settings();
        if ($s['account_name'] !== '') {
            /* translators: %s: name of the Pingsell account. */
            return sprintf(__('Connected to the Pingsell account “%s”.', 'pingsell'), $s['account_name']);
        }
        return __('Connected to Pingsell.', 'pingsell');
    }

    public function handle_disconnect()
    {
        $this->check_admin_action('pingsell_disconnect');
        $this->save(array('api_key' => '', 'api_url' => '', 'account_name' => '', 'manual' => '0'));
        delete_option(self::STATE_OPTION);
        $this->notice('success', __('Disconnected from Pingsell.', 'pingsell'));
        $this->back_to_page();
    }

    /** Fallback: address + key pasted by hand. An empty key field keeps the current key. */
    public function handle_manual()
    {
        $this->check_admin_action('pingsell_manual');
        $url = isset($_POST['api_url']) ? esc_url_raw(trim(sanitize_text_field(wp_unslash($_POST['api_url'])))) : '';
        $url = preg_replace('#/api/v1/?$#', '', untrailingslashit($url));
        $key = isset($_POST['api_key']) ? trim(sanitize_text_field(wp_unslash($_POST['api_key']))) : '';
        if ($url !== '' && !self::valid_api_url($url)) {
            $this->notice('error', __('The API address must start with https:// (http:// is only accepted for a local address).', 'pingsell'));
            $this->back_to_page();
        }
        $changes = array('api_url' => $url, 'manual' => '1', 'account_name' => '');
        if ($key !== '') {
            $changes['api_key'] = $key;
        }
        $this->save($changes);
        $this->notice('success', __('Manual connection saved.', 'pingsell'));
        $this->back_to_page();
    }

    public function handle_test()
    {
        $this->check_admin_action('pingsell_test');
        $res = $this->request('GET', '/me', null, true);
        if (!is_wp_error($res) && wp_remote_retrieve_response_code($res) === 200) {
            $this->notice('success', __('Connection successful: your site is linked to Pingsell.', 'pingsell'));
        } else {
            $json = is_wp_error($res) ? null : json_decode((string) wp_remote_retrieve_body($res), true);
            $msg = is_array($json) && isset($json['error']) && is_string($json['error'])
                ? sanitize_text_field($json['error'])
                : (is_wp_error($res) ? $res->get_error_message() : __('Connection failed: check the address and the key.', 'pingsell'));
            $this->notice('error', $msg);
        }
        $this->back_to_page();
    }

    // ─── Settings page ────────────────────────────────────────────────────────

    private function admin_button_form($action, $label, $class = 'primary', $confirm = '')
    {
        ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline-block;margin:0 8px 0 0"<?php echo $confirm !== '' ? ' data-pingsell-confirm="' . esc_attr($confirm) . '"' : ''; ?>>
            <input type="hidden" name="action" value="<?php echo esc_attr($action); ?>">
            <?php wp_nonce_field($action); ?>
            <?php submit_button($label, $class, 'submit', false); ?>
        </form>
        <?php
    }

    public function settings_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = $this->settings();
        $woo = class_exists('WooCommerce');
        $connected = $this->connected();
        $notice_key = 'pingsell_notice_' . get_current_user_id();
        $notice = get_transient($notice_key);
        if ($notice !== false) {
            delete_transient($notice_key);
        }
        ?>
        <div class="wrap">
            <h1>Pingsell</h1>
            <?php if (is_array($notice) && !empty($notice['message'])) : ?>
                <div class="notice notice-<?php echo esc_attr(in_array($notice['type'], array('success', 'warning', 'error'), true) ? $notice['type'] : 'info'); ?>">
                    <p><?php echo esc_html($notice['message']); ?></p>
                    <?php if (!empty($notice['retry']) && !$connected) : ?>
                        <p><?php $this->admin_button_form('pingsell_connect', __('Try again', 'pingsell'), 'secondary'); ?></p>
                    <?php endif; ?>
                </div>
            <?php endif; ?>

            <h2><?php echo esc_html__('Connection', 'pingsell'); ?></h2>
            <?php if ($connected) : ?>
                <p><strong><?php echo esc_html($this->connected_message()); ?></strong></p>
                <p class="description">
                    <?php
                    /* translators: %s: masked API key, e.g. msv_AbCd…wxyz. */
                    echo esc_html(sprintf(__('API key: %s', 'pingsell'), self::mask_key($s['api_key'])));
                    ?>
                </p>
                <p>
                    <?php $this->admin_button_form('pingsell_test', __('Test the connection', 'pingsell'), 'secondary'); ?>
                    <?php $this->admin_button_form('pingsell_disconnect', __('Disconnect', 'pingsell'), 'secondary', __('Disconnect this site from Pingsell? Events will no longer be sent.', 'pingsell')); ?>
                </p>
            <?php else : ?>
                <p><?php echo esc_html__('Connect your site to Pingsell in one click: sign-ups, carts, orders and shipments then arrive in Pingsell automatically.', 'pingsell'); ?></p>
                <p><?php $this->admin_button_form('pingsell_connect', __('Connect to Pingsell', 'pingsell')); ?></p>
            <?php endif; ?>

            <details style="margin:12px 0 24px">
                <summary style="cursor:pointer"><?php echo esc_html__('Manual connection', 'pingsell'); ?></summary>
                <p><?php echo esc_html__('Only if the button does not work: paste the API address and an API key (Pingsell › Integrations › WordPress).', 'pingsell'); ?></p>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="pingsell_manual">
                    <?php wp_nonce_field('pingsell_manual'); ?>
                    <table class="form-table" role="presentation">
                        <tr>
                            <th scope="row"><label for="pingsell_api_url"><?php echo esc_html__('API address', 'pingsell'); ?></label></th>
                            <td><input id="pingsell_api_url" class="regular-text" type="url" name="api_url" value="<?php echo esc_attr($s['api_url']); ?>" placeholder="<?php echo esc_attr(PINGSELL_API_URL); ?>"></td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="pingsell_api_key"><?php echo esc_html__('API key', 'pingsell'); ?></label></th>
                            <td><input id="pingsell_api_key" class="regular-text code" type="password" autocomplete="off" name="api_key" value="" placeholder="<?php echo esc_attr($connected ? self::mask_key($s['api_key']) : 'msv_…'); ?>">
                                <?php if ($connected) : ?>
                                    <p class="description">
                                        <?php
                                        /* translators: %s: masked API key. */
                                        echo esc_html(sprintf(__('Leave empty to keep the current key (%s).', 'pingsell'), self::mask_key($s['api_key'])));
                                        ?>
                                    </p>
                                <?php endif; ?>
                            </td>
                        </tr>
                    </table>
                    <?php submit_button(__('Save', 'pingsell'), 'secondary', 'submit', false); ?>
                </form>
                <?php if ($connected) : ?>
                    <p><?php $this->admin_button_form('pingsell_test', __('Test the connection', 'pingsell'), 'secondary'); ?></p>
                <?php endif; ?>
            </details>

            <form method="post" action="options.php">
                <?php settings_fields('pingsell'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><?php echo esc_html__('Send to Pingsell', 'pingsell'); ?></th>
                        <td>
                            <?php
                            $boxes = array(
                                'signups'   => __('New customer accounts (sign-up)', 'pingsell'),
                                'carts'     => __('WooCommerce abandoned carts', 'pingsell'),
                                'orders'    => __('WooCommerce orders', 'pingsell'),
                                'shipments' => __('Shipped orders (“Completed” status)', 'pingsell'),
                                'forms'     => __('Site forms (Contact Form 7, WPForms, Gravity Forms, Elementor, Fluent Forms)', 'pingsell'),
                                'tracking'  => __('Visit tracking: pages and products viewed, customers recognised (for “Product viewed without purchase”)', 'pingsell'),
                            );
                            foreach ($boxes as $key => $label) {
                                $disabled = !$woo && in_array($key, array('carts', 'orders', 'shipments'), true);
                                printf(
                                    '<input type="hidden" name="%1$s[%2$s]" value="0"><label style="display:block;margin:0 0 8px"><input type="checkbox" name="%1$s[%2$s]" value="1" %3$s %4$s> %5$s',
                                    esc_attr(self::OPTION),
                                    esc_attr($key),
                                    checked($s[$key], '1', false),
                                    disabled($disabled, true, false),
                                    esc_html($label)
                                );
                                if ($disabled) {
                                    echo ' <em>(' . esc_html__('WooCommerce not installed', 'pingsell') . ')</em>';
                                }
                                echo '</label>';
                                if ($key === 'carts') {
                                    echo '<p class="description" style="margin:-4px 0 8px 24px">' . esc_html__('Logged-in customers: always. Guests: the email typed at checkout is only captured when visit tracking (below) is enabled.', 'pingsell') . '</p>';
                                }
                                if ($key === 'tracking') {
                                    echo '<p class="description" style="margin:-4px 0 8px 24px">' . esc_html__('Off by default. Before enabling it, make sure your cookie banner asks for visitors’ consent (the WP Consent API is supported).', 'pingsell') . '</p>';
                                }
                            }
                            ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="pingsell_form_tags"><?php echo esc_html__('Form tags', 'pingsell'); ?></label></th>
                        <td><input id="pingsell_form_tags" class="regular-text" type="text" name="<?php echo esc_attr(self::OPTION); ?>[form_tags]" value="<?php echo esc_attr($s['form_tags']); ?>">
                            <p class="description"><?php echo esc_html__('Comma-separated. The form name is added automatically.', 'pingsell'); ?></p></td>
                    </tr>
                </table>
                <?php submit_button(__('Save', 'pingsell')); ?>
            </form>
            <h2><?php echo esc_html__('Signup form', 'pingsell'); ?></h2>
            <p><?php echo wp_kses_post(__('Add <code>[pingsell_form]</code> to a page, a post or a “Shortcode” block. Options: <code>title</code>, <code>text</code>, <code>button</code>, <code>tags</code>, <code>fields="first_name,email"</code>, <code>color="#145CFF"</code>.', 'pingsell')); ?></p>
        </div>
        <?php
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
        if ($s['api_key'] === '') {
            return new WP_Error('pingsell_not_configured', __('Pingsell is not configured.', 'pingsell'));
        }
        $args = array(
            'method'   => $method,
            'timeout'  => $blocking ? 10 : 1,
            'blocking' => $blocking,
            'headers'  => array(
                'Authorization'     => 'Bearer ' . $s['api_key'],
                'Content-Type'      => 'application/json',
                'Accept-Language'   => self::lang(),
                'X-Pingsell-Source' => 'wordpress',
                'User-Agent'        => 'Pingsell-WordPress/' . PINGSELL_VERSION,
            ),
        );
        if ($body !== null) {
            $args['body'] = wp_json_encode($body);
        }
        return wp_remote_request($this->api_url() . '/api/v1' . $path, $args);
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
        // phpcs:disable WordPress.Security.NonceVerification.Missing -- read only, during a registration WooCommerce already verified.
        if (!$first && isset($_POST['billing_first_name'])) {
            $first = sanitize_text_field(wp_unslash($_POST['billing_first_name']));
        }
        if (!$last && isset($_POST['billing_last_name'])) {
            $last = sanitize_text_field(wp_unslash($_POST['billing_last_name']));
        }
        // phpcs:enable WordPress.Security.NonceVerification.Missing
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
        // After the page is sent: the cart never waits for Pingsell.
        add_action('shutdown', function () use ($user) {
            $this->send_cart($user->user_email, $user->first_name, $user->last_name);
        });
    }

    /** WP Consent API, when installed: nothing is tracked without the visitor's consent. */
    private static function has_consent($category)
    {
        return !function_exists('wp_has_consent') || wp_has_consent($category);
    }

    /** The Pingsell tracking script (always on the API host, never an address taken as is from a response). */
    private function script_url($inbound)
    {
        $key = is_array($inbound) && isset($inbound['form']['key']) ? (string) $inbound['form']['key'] : '';
        if (!preg_match('/^[A-Za-z0-9_-]{6,128}$/', $key)) {
            return '';
        }
        $url = $this->api_url() . '/api/v1/public/forms/' . rawurlencode($key) . '/embed.js';
        return $this->on_allowed_host($url) ? $url : '';
    }

    /** The Pingsell script on every page; logged-in customers and the buyer on « Commande reçue » are recognised. */
    public function tracking_script()
    {
        if (is_admin() || !$this->may_track()) {
            return;
        }
        // Cached only: the address is fetched after the page is sent, never while the visitor waits.
        $inbound = $this->webhook_url(false);
        $src = $this->script_url($inbound);
        if ($src === '') {
            return;
        }
        wp_enqueue_script('pingsell-form', $src, array(), PINGSELL_VERSION, array('strategy' => 'async', 'in_footer' => false));
        if (!self::has_consent('marketing')) {
            return;
        }
        $email = '';
        if (is_user_logged_in()) {
            $email = wp_get_current_user()->user_email;
        } elseif (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-received') && function_exists('wc_get_order')) {
            global $wp;
            $order = wc_get_order(absint(isset($wp->query_vars['order-received']) ? $wp->query_vars['order-received'] : 0));
            // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read only, checked against the order key with hash_equals.
            $key = isset($_GET['key']) ? sanitize_text_field(wp_unslash($_GET['key'])) : '';
            if ($order && $key !== '' && hash_equals((string) $order->get_order_key(), $key)) {
                $email = $order->get_billing_email();
            }
        }
        if ($email && is_email($email)) {
            wp_add_inline_script('pingsell-form', 'window.Pingsell=window.Pingsell||{q:[]};(Pingsell.q=Pingsell.q||[]).push(["identify",' . wp_json_encode($email) . ']);', 'before');
        }
    }

    /** Visit tracking is allowed on this page: the merchant enabled it and, with the WP Consent API, the visitor agreed. */
    private function may_track()
    {
        return $this->enabled('tracking') && self::has_consent('statistics');
    }

    /** Guests: the email typed at checkout is captured as soon as it is filled in (classic and block checkout). */
    public function checkout_capture_script()
    {
        if (!$this->enabled('carts') || !$this->enabled('tracking') || !self::has_consent('marketing')) {
            return;
        }
        if (!function_exists('is_checkout') || !is_checkout() || (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url('order-received'))) {
            return;
        }
        wp_enqueue_script('pingsell-capture', plugins_url('assets/pingsell-capture.js', __FILE__), array(), PINGSELL_VERSION, true);
        wp_localize_script('pingsell-capture', 'pingsellCapture', array('url' => admin_url('admin-ajax.php')));
    }

    /** The request comes from a page of this site (a nonce would break behind a page cache). */
    private function same_origin()
    {
        $source = isset($_SERVER['HTTP_ORIGIN']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_ORIGIN'])) : '';
        if ($source === '' || $source === 'null') {
            $source = isset($_SERVER['HTTP_REFERER']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_REFERER'])) : '';
        }
        $host = $source !== '' ? wp_parse_url($source, PHP_URL_HOST) : '';
        $site = wp_parse_url(home_url('/'), PHP_URL_HOST);
        return $host && $site && strtolower($host) === strtolower($site);
    }

    /** Public endpoint (also for visitors): tracking on, same origin, consent, 10 calls / 10 min per visitor. */
    public function ajax_capture()
    {
        if (!$this->enabled('carts') || !$this->enabled('tracking')) {
            wp_send_json_error(null, 403);
        }
        if (!$this->same_origin() || !self::has_consent('marketing')) {
            wp_send_json_error(null, 403);
        }
        // Per visitor (IP + WooCommerce session, so customers behind one proxy IP don't share it) and a
        // higher ceiling per IP. REMOTE_ADDR only: forwarded headers can be forged by anyone.
        $ip = isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : '';
        $session = function_exists('WC') && WC()->session ? (string) WC()->session->get_customer_id() : '';
        $bucket = 'pingsell_cap_' . md5($ip . '|' . $session);
        $ip_bucket = 'pingsell_capip_' . md5($ip);
        $hits = (int) get_transient($bucket);
        $ip_hits = (int) get_transient($ip_bucket);
        if ($hits >= self::CAPTURE_LIMIT || $ip_hits >= self::CAPTURE_IP_LIMIT) {
            wp_send_json_error(null, 429);
        }
        set_transient($bucket, $hits + 1, 10 * MINUTE_IN_SECONDS);
        set_transient($ip_bucket, $ip_hits + 1, 10 * MINUTE_IN_SECONDS);
        // phpcs:disable WordPress.Security.NonceVerification.Missing -- public endpoint behind page caches: protected by the origin check and the per-IP limit above.
        $email = isset($_POST['email']) ? sanitize_email(wp_unslash($_POST['email'])) : '';
        if (!$email || !is_email($email)) {
            wp_send_json_error(null, 400);
        }
        $first = isset($_POST['first_name']) ? mb_substr(sanitize_text_field(wp_unslash($_POST['first_name'])), 0, 100) : '';
        $last = isset($_POST['last_name']) ? mb_substr(sanitize_text_field(wp_unslash($_POST['last_name'])), 0, 100) : '';
        // phpcs:enable WordPress.Security.NonceVerification.Missing
        $this->send_cart($email, $first, $last);
        wp_send_json_success();
    }

    // ─── Form plugins → universal webhook (field names detected by Pingsell) ───

    /**
     * The account's webhook and form keys (cached one day; a failure is cached 10 minutes).
     *
     * @param bool $fetch_now false = during a shop page: no call now, it is made after the page is sent.
     */
    private function webhook_url($fetch_now = true)
    {
        $cached = get_transient('pingsell_inbound');
        if (is_array($cached)) {
            return $cached;
        }
        // A recent failure: don't make every page or form submission wait for Pingsell again.
        if (get_transient('pingsell_inbound_failed') || !$this->connected()) {
            return null;
        }
        if (!$fetch_now) {
            static $queued = false;
            if (!$queued) {
                $queued = true;
                add_action('shutdown', array($this, 'fetch_inbound'));
            }
            return null;
        }
        return $this->fetch_inbound();
    }

    public function fetch_inbound()
    {
        $s = $this->settings();
        if ($s['api_key'] === '' || get_transient('pingsell_inbound_failed')) {
            return null;
        }
        $res = wp_remote_get($this->api_url() . '/api/v1/inbound', array(
            'timeout' => 2,
            'headers' => array('Authorization' => 'Bearer ' . $s['api_key'], 'Accept-Language' => self::lang(), 'User-Agent' => 'Pingsell-WordPress/' . PINGSELL_VERSION),
        ));
        $json = is_wp_error($res) || wp_remote_retrieve_response_code($res) !== 200 ? null : json_decode(wp_remote_retrieve_body($res), true);
        if (!is_array($json)) {
            set_transient('pingsell_inbound_failed', 1, 10 * MINUTE_IN_SECONDS);
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
        if (!$inbound || empty($inbound['webhook']['url']) || !$this->on_allowed_host($inbound['webhook']['url'])) {
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
        $url = add_query_arg(array('tags' => rawurlencode(implode(',', $tags))), $inbound['webhook']['url']);
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
        if (!$this->on_allowed_host($url)) {
            return;
        }
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
        $src = $this->script_url($this->webhook_url());
        if ($src === '') {
            return current_user_can('manage_options')
                ? '<p><em>' . esc_html__('Pingsell: connect your site in Settings › Pingsell to display this form.', 'pingsell') . '</em></p>'
                : '';
        }
        wp_enqueue_script('pingsell-form', $src, array(), PINGSELL_VERSION, true);
        // The script that draws the form also tracks visits when the account enables it: without the
        // merchant's choice here (or without the visitor's consent), it is told to draw the form only.
        static $notrack = false;
        if (!$notrack && !$this->may_track()) {
            $notrack = true;
            wp_add_inline_script('pingsell-form', 'window.__pingsellNoTrack=true;', 'before');
        }
        $data = '';
        foreach ($atts as $k => $v) {
            if ($v !== '') {
                $data .= sprintf(' data-%s="%s"', esc_attr($k), esc_attr($v));
            }
        }
        return '<div data-pingsell-form' . $data . '></div>';
    }
}

register_activation_hook(__FILE__, array('Pingsell_Plugin', 'activate'));
Pingsell_Plugin::instance();

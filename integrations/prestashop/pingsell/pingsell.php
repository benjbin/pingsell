<?php
/**
 * NOTICE OF LICENSE
 *
 * This source file is subject to the Academic Free License version 3.0
 * that is bundled with this package in the file LICENSE.
 * It is also available through the world-wide-web at this URL:
 * https://opensource.org/licenses/AFL-3.0
 *
 * DISCLAIMER
 *
 * Do not edit or add to this file if you wish to upgrade this module to newer
 * versions in the future. If you wish to customize this module for your
 * needs please refer to the module documentation (docs/README.md).
 *
 * @author    Pingsell
 * @copyright Since 2024 Pingsell
 * @license   https://opensource.org/licenses/AFL-3.0 Academic Free License version 3.0
 */
if (!defined('_PS_VERSION_')) {
    exit;
}

/**
 * Pingsell for PrestaShop 1.7, 8 and 9: sign-ups, abandoned carts, orders and shipments sent to Pingsell,
 * which triggers the right emails automatically.
 */
class Pingsell extends Module
{
    /** Default address of the Pingsell web app (connection page) and of its API. */
    const DEFAULT_APP_URL = 'https://app.pingsell.neokrome.tech';

    /** How long a « Connect to Pingsell » attempt stays valid (seconds). */
    const STATE_TTL = 900;

    /** Network calls made while a shop page, the cart or the checkout is served (milliseconds). */
    const FRONT_TIMEOUT_MS = 2000;
    const FRONT_CONNECT_TIMEOUT_MS = 1000;

    /** Network calls made from the back office (connection, test). */
    const ADMIN_TIMEOUT_MS = 8000;

    /** Event switches shown in the settings. */
    private static $switches = array(
        'PINGSELL_SIGNUPS',
        'PINGSELL_CARTS',
        'PINGSELL_ORDERS',
        'PINGSELL_SHIPMENTS',
        'PINGSELL_FOOTER_FORM',
        'PINGSELL_TRACKING',
    );

    /**
     * Every configuration value of the module. PINGSELL_APP_URL and PINGSELL_API_URL are never shown in the
     * settings: they can only be changed by code or SQL (PINGSELL_API_URL also by the manual connection).
     */
    private static $keys = array(
        'PINGSELL_APP_URL',
        'PINGSELL_API_URL',
        'PINGSELL_API_KEY',
        'PINGSELL_ACCOUNT_NAME',
        'PINGSELL_CONNECT_STATE',
        'PINGSELL_CONNECT_STATE_AT',
        'PINGSELL_INBOUND',
        'PINGSELL_SIGNUPS',
        'PINGSELL_CARTS',
        'PINGSELL_ORDERS',
        'PINGSELL_SHIPMENTS',
        'PINGSELL_FOOTER_FORM',
        'PINGSELL_TRACKING',
    );

    /** Events waiting to be sent once the page has been delivered to the visitor. */
    private static $queue = array();
    private static $flushRegistered = false;

    public function __construct()
    {
        $this->name = 'pingsell';
        $this->tab = 'emailing';
        $this->version = '1.3.0';
        $this->author = 'Pingsell';
        $this->need_instance = 0;
        $this->bootstrap = true;
        // TODO: clé fournie par l'espace vendeur Addons
        $this->module_key = '';
        $this->ps_versions_compliancy = array('min' => '1.7.0.0', 'max' => '9.99.99');
        parent::__construct();
        $this->displayName = $this->l('Pingsell');
        $this->description = $this->l('Sends sign-ups, abandoned carts, orders and shipments to Pingsell, no code needed.');
        $this->confirmUninstall = $this->l('Your shop will no longer be linked to Pingsell. Continue?');
    }

    public function install()
    {
        // Fresh install: visitor tracking stays off until the merchant switches it on.
        return parent::install()
            && $this->registerHook('actionCustomerAccountAdd')
            && $this->registerHook('actionNewsletterRegistrationAfter')
            && $this->registerHook('actionCartSave')
            && $this->registerHook('actionValidateOrder')
            && $this->registerHook('actionOrderStatusPostUpdate')
            && $this->registerHook('actionAdminOrdersTrackingNumberUpdate')
            && $this->registerHook('displayFooterBefore')
            && $this->registerHook('displayHeader')
            && Configuration::updateValue('PINGSELL_TRACKING', 0)
            && Configuration::updateValue('PINGSELL_SIGNUPS', 1)
            && Configuration::updateValue('PINGSELL_CARTS', 1)
            && Configuration::updateValue('PINGSELL_ORDERS', 1)
            && Configuration::updateValue('PINGSELL_SHIPMENTS', 1)
            && Configuration::updateValue('PINGSELL_FOOTER_FORM', 0);
    }

    public function uninstall()
    {
        foreach (self::$keys as $key) {
            Configuration::deleteByName($key);
        }

        return parent::uninstall();
    }

    // ─── Addresses ────────────────────────────────────────────────────────────

    /** Pingsell web app (connection page). */
    public function appUrl()
    {
        $url = $this->normalizeBase(Configuration::get('PINGSELL_APP_URL'));

        return $url !== '' && $this->isAllowedBase($url, true) ? $url : self::DEFAULT_APP_URL;
    }

    /** Pingsell API base (without /api/v1). Defaults to the web app address. */
    public function apiUrl()
    {
        $url = $this->normalizeBase(Configuration::get('PINGSELL_API_URL'));

        return $url !== '' && $this->isAllowedBase($url, true) ? $url : $this->appUrl();
    }

    private function normalizeBase($url)
    {
        $url = rtrim(trim((string) $url), '/');

        return (string) preg_replace('#/api/v1$#', '', $url);
    }

    /** Local development address: http://localhost, 127.0.0.1, *.localhost or *.test. */
    private function isLocalHost($host)
    {
        $host = Tools::strtolower((string) $host);

        return $host === 'localhost' || $host === '127.0.0.1' || $host === '[::1]'
            || preg_match('/\.(localhost|test)$/', $host) === 1;
    }

    /** https, or http on a local development host when $allowLocal is true. */
    private function isAllowedBase($url, $allowLocal)
    {
        $parts = parse_url((string) $url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            return false;
        }
        $scheme = Tools::strtolower($parts['scheme']);
        if ($scheme === 'https') {
            return true;
        }

        return $allowLocal && $scheme === 'http' && $this->isLocalHost($parts['host']);
    }

    private function hostOf($url)
    {
        $host = parse_url((string) $url, PHP_URL_HOST);

        return $host ? Tools::strtolower($host) : '';
    }

    /** Public address of the shop. */
    public function shopUrl()
    {
        $shop = isset($this->context->shop) ? $this->context->shop : null;
        if ($shop && method_exists($shop, 'getBaseURL')) {
            $url = (string) $shop->getBaseURL(true);
            if ($url !== '') {
                return $url;
            }
        }

        return Tools::getShopDomainSsl(true) . __PS_BASE_URI__;
    }

    /**
     * Absolute address of this configuration page (legacy AdminModules controller, which keeps the query
     * string on PrestaShop 1.7, 8 and 9).
     */
    public function adminUrl()
    {
        $base = Tools::getShopDomainSsl(true) . __PS_BASE_URI__ . basename(_PS_ADMIN_DIR_) . '/index.php';

        return $base . '?' . http_build_query(array(
            'controller'  => 'AdminModules',
            'configure'   => $this->name,
            'tab_module'  => $this->tab,
            'module_name' => $this->name,
            'token'       => Tools::getAdminTokenLite('AdminModules'),
        ), '', '&');
    }

    // ─── Configuration page ───────────────────────────────────────────────────

    public function getContent()
    {
        // Back-office employees only (the AdminModules token has already been checked by PrestaShop).
        if (!isset($this->context->employee) || !Validate::isLoadedObject($this->context->employee)) {
            return '';
        }
        $out = '';
        if (Tools::getValue('pingsell_error') !== false && Tools::getValue('pingsell_error') !== '') {
            $out .= $this->handleDenied();
        } elseif (Tools::getValue('pingsell_code') !== false && Tools::getValue('pingsell_code') !== '') {
            $out .= $this->handleReturn();
        } elseif (Tools::isSubmit('submitPingsellConnect')) {
            $this->startConnect();
        } elseif (Tools::isSubmit('submitPingsellDisconnect')) {
            Configuration::updateValue('PINGSELL_API_KEY', '');
            Configuration::updateValue('PINGSELL_ACCOUNT_NAME', '');
            Configuration::deleteByName('PINGSELL_INBOUND');
            $out .= $this->displayConfirmation($this->l('Your shop is no longer connected to Pingsell.'));
        } elseif (Tools::isSubmit('submitPingsellSettings')) {
            foreach (self::$switches as $key) {
                Configuration::updateValue($key, (int) (bool) Tools::getValue($key));
            }
            Configuration::deleteByName('PINGSELL_INBOUND');
            $out .= $this->displayConfirmation($this->l('Settings saved.'));
        } elseif (Tools::isSubmit('submitPingsellManual')) {
            $out .= $this->handleManual();
        }

        return $out . $this->renderConfiguration();
    }

    /** « Connect to Pingsell »: a one-time state, then the Pingsell connection page. */
    private function startConnect()
    {
        $state = bin2hex($this->randomBytes(32));
        Configuration::updateValue('PINGSELL_CONNECT_STATE', $state);
        Configuration::updateValue('PINGSELL_CONNECT_STATE_AT', time());
        Tools::redirect($this->connectUrl($state));
    }

    public function connectUrl($state)
    {
        return $this->appUrl() . '/connecter/boutique?' . http_build_query(array(
            'platform'   => 'prestashop',
            'site'       => $this->shopUrl(),
            'return_url' => $this->adminUrl(),
            'state'      => $state,
        ), '', '&', PHP_QUERY_RFC3986);
    }

    private function randomBytes($length)
    {
        if (function_exists('random_bytes')) {
            return random_bytes($length);
        }

        return openssl_random_pseudo_bytes($length);
    }

    /** The state sent back by Pingsell matches the one stored here and is less than 15 minutes old. */
    private function checkState($received)
    {
        $stored = (string) Configuration::get('PINGSELL_CONNECT_STATE');
        $at = (int) Configuration::get('PINGSELL_CONNECT_STATE_AT');
        if ($stored === '' || !is_string($received) || $received === '') {
            return false;
        }
        if (!hash_equals($stored, $received)) {
            return false;
        }

        return $at > 0 && time() - $at < self::STATE_TTL;
    }

    private function clearState()
    {
        Configuration::deleteByName('PINGSELL_CONNECT_STATE');
        Configuration::deleteByName('PINGSELL_CONNECT_STATE_AT');
    }

    private function handleDenied()
    {
        if ($this->checkState((string) Tools::getValue('state'))) {
            $this->clearState();
        }
        if ((string) Tools::getValue('pingsell_error') === 'access_denied') {
            return $this->displayWarning($this->l('Connection cancelled.'));
        }

        return $this->displayError($this->l('The connection failed. Please try again.'));
    }

    /** Back from Pingsell with a one-time code: exchanged server to server for an API key. */
    private function handleReturn()
    {
        $code = (string) Tools::getValue('pingsell_code');
        if (!$this->checkState((string) Tools::getValue('state'))) {
            return $this->displayError($this->l('This connection link has expired. Click “Connect to Pingsell” again.'));
        }
        $this->clearState();
        if (!preg_match('/^[A-Za-z0-9_-]{16,128}$/', $code)) {
            return $this->displayError($this->l('This connection link has expired. Click “Connect to Pingsell” again.'));
        }
        $api = $this->apiUrl();
        $res = $this->request('POST', '/public/connect/exchange', array(
            'code'     => $code,
            'platform' => 'prestashop',
            'site'     => $this->shopUrl(),
        ), array('auth' => false, 'timeout' => self::ADMIN_TIMEOUT_MS, 'base' => $api));
        $json = json_decode($res['body'], true);
        if ($res['code'] !== 200 || !is_array($json) || empty($json['api_key']) || !is_string($json['api_key'])) {
            $reason = $res['error'] !== '' ? $res['error'] : $this->l('No answer from Pingsell.');

            return $this->displayError($this->l('The connection failed:') . ' ' . htmlspecialchars((string) $reason, ENT_QUOTES, 'UTF-8'));
        }
        // The API address only changes to an address on the same host (https, or http for local development).
        if (!empty($json['api_url']) && is_string($json['api_url'])) {
            $returned = $this->normalizeBase($json['api_url']);
            $apiIsLocal = !$this->isAllowedBase($api, false);
            if ($this->isAllowedBase($returned, $apiIsLocal) && $this->hostOf($returned) === $this->hostOf($api)) {
                Configuration::updateValue('PINGSELL_API_URL', $returned);
            }
        }
        $name = isset($json['account_name']) && is_string($json['account_name']) ? Tools::substr($json['account_name'], 0, 120) : '';
        Configuration::updateValue('PINGSELL_API_KEY', trim($json['api_key']));
        Configuration::updateValue('PINGSELL_ACCOUNT_NAME', $name);
        Configuration::deleteByName('PINGSELL_INBOUND');

        return $this->displayConfirmation($this->l('Connected to the Pingsell account') . ' « ' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . ' ».');
    }

    /** « Manual connection »: API address and key pasted by the merchant. */
    private function handleManual()
    {
        $url = $this->normalizeBase(Tools::getValue('PINGSELL_MANUAL_URL'));
        $key = trim((string) Tools::getValue('PINGSELL_MANUAL_KEY'));
        if ($url !== '' && !$this->isAllowedBase($url, true)) {
            return $this->displayError($this->l('The API address must start with https://'));
        }
        if ($key !== '' && !preg_match('/^msv_[A-Za-z0-9_-]{8,200}$/', $key)) {
            return $this->displayError($this->l('This API key is not valid.'));
        }
        if ($url !== '') {
            Configuration::updateValue('PINGSELL_API_URL', $url);
        }
        if ($key !== '') {
            Configuration::updateValue('PINGSELL_API_KEY', $key);
        }
        Configuration::deleteByName('PINGSELL_INBOUND');
        $test = $this->request('GET', '/me', null, array('timeout' => self::ADMIN_TIMEOUT_MS));
        if ($test['code'] === 200) {
            $me = json_decode($test['body'], true);
            $name = is_array($me) && isset($me['name']) && is_string($me['name']) ? Tools::substr($me['name'], 0, 120) : '';
            Configuration::updateValue('PINGSELL_ACCOUNT_NAME', $name);

            return $this->displayConfirmation($this->l('Connection successful: your shop is linked to Pingsell.'));
        }

        return $this->displayError($this->l('Settings saved, but the connection failed:') . ' ' . htmlspecialchars((string) $test['error'], ENT_QUOTES, 'UTF-8'));
    }

    /** « msv_abcd…wxyz »: the key is never shown again in full. */
    public function maskKey($key)
    {
        $key = (string) $key;
        if ($key === '') {
            return '';
        }
        if (Tools::strlen($key) <= 12) {
            return Tools::substr($key, 0, 4) . '…';
        }

        return Tools::substr($key, 0, 8) . '…' . Tools::substr($key, -4);
    }

    private function renderConfiguration()
    {
        $key = (string) Configuration::get('PINGSELL_API_KEY');
        $values = array();
        foreach (self::$switches as $switch) {
            $values[$switch] = (int) Configuration::get($switch) === 1;
        }
        $this->context->smarty->assign(array(
            'pingsell_connected'   => $key !== '',
            'pingsell_account'     => (string) Configuration::get('PINGSELL_ACCOUNT_NAME'),
            'pingsell_masked_key'  => $this->maskKey($key),
            'pingsell_api_url'     => $this->apiUrl(),
            'pingsell_shop_host'   => $this->hostOf($this->shopUrl()),
            'pingsell_form_action' => $this->adminUrl(),
            'pingsell_values'      => $values,
            'pingsell_version'     => $this->version,
        ));

        return $this->context->smarty->fetch($this->local_path . 'views/templates/admin/configure.tpl');
    }

    // ─── Transport ────────────────────────────────────────────────────────────

    private function enabled($key)
    {
        return Configuration::get('PINGSELL_API_KEY') && (int) Configuration::get($key) === 1;
    }

    /**
     * Returns array('code' => int, 'body' => string, 'error' => string). Options: auth (default true),
     * timeout in ms (default: front-office timeout), base (default: the API address).
     */
    private function request($method, $path, $body = null, array $options = array())
    {
        $base = isset($options['base']) ? $options['base'] : $this->apiUrl();
        $auth = !isset($options['auth']) || $options['auth'];
        $timeout = isset($options['timeout']) ? (int) $options['timeout'] : self::FRONT_TIMEOUT_MS;
        $key = (string) Configuration::get('PINGSELL_API_KEY');
        if (!function_exists('curl_init')) {
            return array('code' => 0, 'body' => '', 'error' => 'cURL');
        }
        if ($auth && $key === '') {
            return array('code' => 0, 'body' => '', 'error' => $this->l('Your shop is not connected to Pingsell.'));
        }
        $headers = array(
            'Content-Type: application/json',
            'Accept: application/json',
            'Accept-Language: ' . $this->languageCode(),
            'X-Pingsell-Source: prestashop',
            'User-Agent: Pingsell-PrestaShop/' . $this->version,
        );
        if ($auth) {
            $headers[] = 'Authorization: Bearer ' . $key;
        }
        $ch = curl_init($base . '/api/v1' . $path);
        curl_setopt_array($ch, array(
            CURLOPT_CUSTOMREQUEST     => $method,
            CURLOPT_RETURNTRANSFER    => true,
            CURLOPT_CONNECTTIMEOUT_MS => min($timeout, self::FRONT_CONNECT_TIMEOUT_MS * 3),
            CURLOPT_TIMEOUT_MS        => $timeout,
            CURLOPT_NOSIGNAL          => 1,
            CURLOPT_FOLLOWLOCATION    => false,
            CURLOPT_HTTPHEADER        => $headers,
        ));
        if ($timeout <= self::FRONT_TIMEOUT_MS) {
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT_MS, self::FRONT_CONNECT_TIMEOUT_MS);
        }
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $res = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        if (PHP_VERSION_ID < 80000) {
            curl_close($ch);
        }
        $json = is_string($res) ? json_decode($res, true) : null;
        if ($err === '' && is_array($json) && isset($json['error'])) {
            $err = is_string($json['error']) ? $json['error'] : (isset($json['error']['message']) ? (string) $json['error']['message'] : '');
        }
        if ($err === '' && $code !== 200 && $code !== 201) {
            $err = $code ? 'HTTP ' . $code : $this->l('No answer from Pingsell.');
        }

        return array('code' => $code, 'body' => is_string($res) ? $res : '', 'error' => (string) $err);
    }

    private function languageCode()
    {
        $lang = isset($this->context->language) && isset($this->context->language->iso_code) ? $this->context->language->iso_code : 'fr';

        return preg_match('/^[a-z]{2}$/i', (string) $lang) ? Tools::strtolower($lang) : 'fr';
    }

    /**
     * Events are sent after the page has been delivered (fastcgi_finish_request when available), with a short
     * timeout: the shop never waits for Pingsell.
     */
    public function sendEvent($event, array $data)
    {
        if (empty($data['email']) || !Validate::isEmail($data['email'])) {
            return;
        }
        $data = array_filter(array_merge(array('event' => $event), $data), function ($v) {
            return $v !== null && $v !== '' && $v !== array();
        });
        self::$queue[] = $data;
        if (!self::$flushRegistered) {
            self::$flushRegistered = true;
            register_shutdown_function(array($this, 'flushEvents'));
        }
    }

    public function flushEvents()
    {
        if (!self::$queue) {
            return;
        }
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        }
        $queue = self::$queue;
        self::$queue = array();
        foreach ($queue as $data) {
            try {
                $this->request('POST', '/events', $data);
            } catch (Exception $e) {
                // Never break the checkout.
            }
        }
    }

    // ─── Customers ────────────────────────────────────────────────────────────

    public function hookActionCustomerAccountAdd($params)
    {
        if (!$this->enabled('PINGSELL_SIGNUPS') || empty($params['newCustomer'])) {
            return;
        }
        $c = $params['newCustomer'];
        // Only customers who ticked the newsletter box become marketing contacts (consent); the others
        // arrive with their first order.
        if (empty($c->newsletter)) {
            return;
        }
        $tags = array($c->is_guest ? 'invite' : 'compte-client', 'newsletter');
        $this->sendEvent('inscription', array(
            'email'      => $c->email,
            'first_name' => $c->firstname,
            'last_name'  => $c->lastname,
            'tags'       => $tags,
        ));
    }

    /** ps_emailsubscription (newsletter block). */
    public function hookActionNewsletterRegistrationAfter($params)
    {
        // action 0 = subscribe (1 = unsubscribe); with double opt-in the hook fires once confirmed.
        $action = isset($params['action']) ? (int) $params['action'] : 0;
        if ($this->enabled('PINGSELL_SIGNUPS') && $action === 0 && empty($params['error']) && !empty($params['email'])) {
            $this->sendEvent('inscription', array('email' => $params['email'], 'tags' => array('newsletter')));
        }
    }

    // ─── Carts ────────────────────────────────────────────────────────────────

    public function hookActionCartSave($params)
    {
        if (!$this->enabled('PINGSELL_CARTS')) {
            return;
        }
        $cart = isset($params['cart']) && $params['cart'] ? $params['cart'] : $this->context->cart;
        if (!Validate::isLoadedObject($cart) || !$cart->id_customer || $cart->orderExists()) {
            return;
        }
        $customer = new Customer((int) $cart->id_customer);
        if (!Validate::isLoadedObject($customer)) {
            return;
        }
        $items = array();
        foreach ($cart->getProducts() as $p) {
            $items[] = array(
                'title'    => Tools::substr($p['name'], 0, 200),
                'quantity' => max(1, (int) $p['cart_quantity']),
                'price'    => round((float) $p['price_wt'], 2),
            );
        }
        if (!$items) {
            return;
        }
        // Once per request (counted only once there are products: the very first add saves an empty cart first).
        static $sent = array();
        if (isset($sent[$cart->id])) {
            return;
        }
        $sent[$cart->id] = true;
        $currency = new Currency((int) $cart->id_currency);
        $this->sendEvent('panier', array(
            'email'      => $customer->email,
            'first_name' => $customer->firstname,
            'last_name'  => $customer->lastname,
            'id'         => 'ps-' . (int) $cart->id,
            'total'      => round((float) $cart->getOrderTotal(true, Cart::BOTH), 2),
            'currency'   => $currency->iso_code,
            'url'        => $this->context->link->getPageLink('cart', true, null, array('action' => 'show')),
            'items'      => array_slice($items, 0, 50),
        ));
    }

    // ─── Orders ───────────────────────────────────────────────────────────────

    private function orderPayload($order, $customer = null)
    {
        $customer = $customer ?: new Customer((int) $order->id_customer);
        $address = new Address((int) $order->id_address_invoice);
        $currency = new Currency((int) $order->id_currency);
        $items = array();
        foreach ($order->getProducts() as $p) {
            $items[] = array(
                'title'    => Tools::substr($p['product_name'], 0, 200),
                'quantity' => max(1, (int) $p['product_quantity']),
                'price'    => round((float) $p['unit_price_tax_incl'], 2),
            );
        }

        return array(
            'email'      => $customer->email,
            'first_name' => $customer->firstname,
            'last_name'  => $customer->lastname,
            'phone'      => $address->phone_mobile ?: $address->phone,
            'id'         => $order->reference,
            'total'      => round((float) $order->total_paid_tax_incl, 2),
            'currency'   => $currency->iso_code,
            'items'      => array_slice($items, 0, 50),
        );
    }

    public function hookActionValidateOrder($params)
    {
        if (!$this->enabled('PINGSELL_ORDERS') || empty($params['order'])) {
            return;
        }
        // Declined payment or cancelled at creation: not a purchase.
        $status = isset($params['orderStatus']) ? $params['orderStatus'] : null;
        if ($status && in_array((int) $status->id, array((int) Configuration::get('PS_OS_ERROR'), (int) Configuration::get('PS_OS_CANCELED')), true)) {
            return;
        }
        $order = $params['order'];
        $data = $this->orderPayload($order, isset($params['customer']) ? $params['customer'] : null);
        $this->sendEvent('commande', $data);
    }

    private function sendShipment($order)
    {
        if (!$this->enabled('PINGSELL_SHIPMENTS')) {
            return;
        }
        // Not sent again as an order: an order placed before the module was installed must not get a late « thank you ».
        $data = $this->orderPayload($order);
        $tracking = $order->getWsShippingNumber();
        $carrier = new Carrier((int) $order->id_carrier);
        $url = $tracking && $carrier->url ? str_replace('@', rawurlencode($tracking), $carrier->url) : null;
        $this->sendEvent('expedition', array(
            'email'           => $data['email'],
            'id'              => $data['id'],
            'tracking_number' => $tracking ?: null,
            'tracking_url'    => $url,
            'carrier'         => Validate::isLoadedObject($carrier) ? $carrier->name : null,
        ));
    }

    public function hookActionOrderStatusPostUpdate($params)
    {
        $status = isset($params['newOrderStatus']) ? $params['newOrderStatus'] : null;
        if (!$status || empty($params['id_order'])) {
            return;
        }
        $shipped = !empty($status->shipped) || (int) $status->id === (int) Configuration::get('PS_OS_SHIPPING');
        if ($shipped) {
            $this->sendShipment(new Order((int) $params['id_order']));
        }
    }

    /** Tracking number added after the « Shipped » status: send it again with the number. */
    public function hookActionAdminOrdersTrackingNumberUpdate($params)
    {
        if (!empty($params['order'])) {
            $this->sendShipment($params['order']);
        }
    }

    // ─── Pingsell script ──────────────────────────────────────────────────────

    /** Account settings of the signup form / tracking script, cached one day (a failure for 10 minutes). */
    private function inbound()
    {
        $cached = Configuration::get('PINGSELL_INBOUND');
        $json = $cached ? json_decode($cached, true) : null;
        if (is_array($json) && isset($json['at']) && $json['at'] > time() - 86400 && !empty($json['form_key'])) {
            return $json;
        }
        if (is_array($json) && !empty($json['failed_at']) && $json['failed_at'] > time() - 600) {
            return null;
        }
        $res = $this->request('GET', '/inbound');
        $json = $res['code'] === 200 ? json_decode($res['body'], true) : null;
        $formKey = is_array($json) && isset($json['form']['key']) && is_string($json['form']['key']) ? $json['form']['key'] : '';
        if ($formKey === '') {
            // Unreachable or wrong key: don't retry on every page view (10 min).
            Configuration::updateValue('PINGSELL_INBOUND', json_encode(array('failed_at' => time())));

            return null;
        }
        $keep = array('at' => time(), 'form_key' => $formKey);
        Configuration::updateValue('PINGSELL_INBOUND', json_encode($keep));

        return $keep;
    }

    /**
     * Address of the Pingsell script, always built on the host of the API address (never an address
     * returned by the API), with the module version.
     */
    public function scriptUrl()
    {
        $inbound = $this->inbound();
        if (!$inbound || empty($inbound['form_key']) || !preg_match('/^[A-Za-z0-9_-]{8,128}$/', $inbound['form_key'])) {
            return '';
        }
        $api = $this->apiUrl();
        if (!$this->isAllowedBase($api, true)) {
            return '';
        }

        return $api . '/api/v1/public/forms/' . $inbound['form_key'] . '/embed.js?ver=' . rawurlencode($this->version);
    }

    public function hookDisplayFooterBefore($params)
    {
        if (!$this->enabled('PINGSELL_FOOTER_FORM')) {
            return '';
        }
        $script = $this->scriptUrl();
        if ($script === '') {
            return '';
        }
        $this->context->smarty->assign(array(
            'pingsell_script_url' => $script,
            // The header already loads the script when tracking is on.
            'pingsell_load_script' => !$this->enabled('PINGSELL_TRACKING'),
        ));

        return $this->display(__FILE__, 'views/templates/hook/footer_form.tpl');
    }

    /**
     * Visitor tracking (off by default, the merchant switches it on): the Pingsell script on every page,
     * pages and products seen. Logged-in customers, and the buyer on the order confirmation page, are
     * recognised straight away.
     */
    public function hookDisplayHeader($params)
    {
        if (!$this->enabled('PINGSELL_TRACKING')) {
            return '';
        }
        $script = $this->scriptUrl();
        if ($script === '') {
            return '';
        }
        $email = '';
        $customer = $this->context->customer;
        if ($customer && $customer->isLogged() && Validate::isEmail($customer->email)) {
            $email = $customer->email;
        } elseif (isset($this->context->controller->php_self) && $this->context->controller->php_self === 'order-confirmation') {
            $order = new Order((int) Tools::getValue('id_order'));
            $buyer = Validate::isLoadedObject($order) ? new Customer((int) $order->id_customer) : null;
            if ($buyer && Validate::isLoadedObject($buyer) && is_string($buyer->secure_key) && $buyer->secure_key !== ''
                && hash_equals($buyer->secure_key, (string) Tools::getValue('key'))) {
                $email = $buyer->email;
            }
        }
        $this->context->smarty->assign(array(
            'pingsell_script_url' => $script,
            'pingsell_email'      => $email,
        ));

        return $this->display(__FILE__, 'views/templates/hook/header.tpl');
    }
}

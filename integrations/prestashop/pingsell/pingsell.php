<?php
/**
 * Pingsell pour PrestaShop 1.7, 8 et 9 : inscriptions, paniers abandonnés, commandes et expéditions
 * envoyés à Pingsell, qui déclenche les bons emails automatiquement.
 *
 * @author    Pingsell
 * @license   AFL-3.0
 */
if (!defined('_PS_VERSION_')) {
    exit;
}

class Pingsell extends Module
{
    private static $keys = array(
        'PINGSELL_API_URL',
        'PINGSELL_API_KEY',
        'PINGSELL_SIGNUPS',
        'PINGSELL_CARTS',
        'PINGSELL_ORDERS',
        'PINGSELL_SHIPMENTS',
        'PINGSELL_FOOTER_FORM',
        'PINGSELL_TRACKING',
    );

    public function __construct()
    {
        $this->name = 'pingsell';
        $this->tab = 'emailing';
        $this->version = '1.2.0';
        $this->author = 'Pingsell';
        $this->need_instance = 0;
        $this->bootstrap = true;
        $this->ps_versions_compliancy = array('min' => '1.7.0.0', 'max' => '9.99.99');
        parent::__construct();
        $this->displayName = $this->l('Pingsell');
        $this->description = $this->l('Inscriptions, paniers abandonnés, commandes et expéditions envoyés à Pingsell, sans code.');
        $this->confirmUninstall = $this->l('Votre boutique ne sera plus reliée à Pingsell. Continuer ?');
    }

    public function install()
    {
        return parent::install()
            && $this->registerHook('actionCustomerAccountAdd')
            && $this->registerHook('actionNewsletterRegistrationAfter')
            && $this->registerHook('actionCartSave')
            && $this->registerHook('actionValidateOrder')
            && $this->registerHook('actionOrderStatusPostUpdate')
            && $this->registerHook('actionAdminOrdersTrackingNumberUpdate')
            && $this->registerHook('displayFooterBefore')
            && $this->registerHook('displayHeader')
            && Configuration::updateValue('PINGSELL_TRACKING', 1)
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
        Configuration::deleteByName('PINGSELL_INBOUND');
        return parent::uninstall();
    }

    // ─── Configuration page ───────────────────────────────────────────────────

    public function getContent()
    {
        $out = '';
        if (Tools::isSubmit('submitPingsell')) {
            $url = rtrim(trim((string) Tools::getValue('PINGSELL_API_URL')), '/');
            $url = preg_replace('#/api/v1$#', '', $url);
            if ($url !== '' && !preg_match('#^(https://|http://(localhost|127\.0\.0\.1)(:\d+)?(/|$))#i', $url)) {
                $out .= $this->displayError($this->l('L’adresse de l’API doit commencer par https://'));
            } else {
                Configuration::updateValue('PINGSELL_API_URL', $url);
                Configuration::updateValue('PINGSELL_API_KEY', trim((string) Tools::getValue('PINGSELL_API_KEY')));
                foreach (array('PINGSELL_SIGNUPS', 'PINGSELL_CARTS', 'PINGSELL_ORDERS', 'PINGSELL_SHIPMENTS', 'PINGSELL_FOOTER_FORM', 'PINGSELL_TRACKING') as $key) {
                    Configuration::updateValue($key, (int) (bool) Tools::getValue($key));
                }
                Configuration::deleteByName('PINGSELL_INBOUND');
                $test = $this->request('GET', '/me', null, true);
                if ($test['code'] === 200) {
                    $out .= $this->displayConfirmation($this->l('Connexion réussie : votre boutique est reliée à Pingsell.'));
                } else {
                    $out .= $this->displayError($this->l('Réglages enregistrés, mais la connexion a échoué : ') . htmlspecialchars((string) $test['error'], ENT_QUOTES, 'UTF-8'));
                }
            }
        }
        return $out . $this->renderForm();
    }

    private function renderForm()
    {
        $helper = new HelperForm();
        $helper->module = $this;
        $helper->name_controller = $this->name;
        $helper->token = Tools::getAdminTokenLite('AdminModules');
        $helper->currentIndex = AdminController::$currentIndex . '&configure=' . $this->name;
        $helper->submit_action = 'submitPingsell';
        $helper->default_form_language = (int) Configuration::get('PS_LANG_DEFAULT');
        foreach (self::$keys as $key) {
            $helper->fields_value[$key] = Configuration::get($key);
        }
        // Installed before 1.2: tracking is on until switched off.
        if (Configuration::get('PINGSELL_TRACKING') === false) {
            $helper->fields_value['PINGSELL_TRACKING'] = 1;
        }
        $switch = function ($name, $label) {
            return array(
                'type'    => 'switch',
                'label'   => $label,
                'name'    => $name,
                'is_bool' => true,
                'values'  => array(
                    array('id' => $name . '_on', 'value' => 1, 'label' => $this->l('Oui')),
                    array('id' => $name . '_off', 'value' => 0, 'label' => $this->l('Non')),
                ),
            );
        };
        return $helper->generateForm(array(array('form' => array(
            'legend' => array('title' => $this->l('Connexion à Pingsell'), 'icon' => 'icon-envelope'),
            'description' => $this->l('Collez l’adresse de l’API et votre clé API (Pingsell › Intégrations › PrestaShop). Tout le reste est automatique.'),
            'input'  => array(
                array('type' => 'text', 'label' => $this->l('Adresse de l’API'), 'name' => 'PINGSELL_API_URL', 'placeholder' => 'https://app.pingsell.neokrome.tech', 'required' => true),
                array('type' => 'text', 'label' => $this->l('Clé API'), 'name' => 'PINGSELL_API_KEY', 'placeholder' => 'msv_…', 'required' => true),
                $switch('PINGSELL_SIGNUPS', $this->l('Nouveaux comptes et inscriptions newsletter')),
                $switch('PINGSELL_CARTS', $this->l('Paniers abandonnés')),
                $switch('PINGSELL_ORDERS', $this->l('Commandes')),
                $switch('PINGSELL_SHIPMENTS', $this->l('Commandes expédiées')),
                $switch('PINGSELL_FOOTER_FORM', $this->l('Formulaire d’inscription Pingsell au-dessus du pied de page')),
                $switch('PINGSELL_TRACKING', $this->l('Suivi des visites : pages et produits vus, clients reconnus (pour « Produit consulté sans achat »)')),
            ),
            'submit' => array('title' => $this->l('Enregistrer et tester')),
        ))));
    }

    // ─── Transport ────────────────────────────────────────────────────────────

    private function enabled($key)
    {
        return Configuration::get('PINGSELL_API_URL') && Configuration::get('PINGSELL_API_KEY') && (int) Configuration::get($key) === 1;
    }

    /**
     * Short timeouts: the shop must never wait for Pingsell. Returns ['code' => int, 'body' => string, 'error' => string].
     */
    private function request($method, $path, $body = null, $wait = false)
    {
        $base = (string) Configuration::get('PINGSELL_API_URL');
        $key = (string) Configuration::get('PINGSELL_API_KEY');
        if ($base === '' || $key === '' || !function_exists('curl_init')) {
            return array('code' => 0, 'body' => '', 'error' => $this->l('Adresse ou clé manquante.'));
        }
        $ch = curl_init($base . '/api/v1' . $path);
        curl_setopt_array($ch, array(
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => 1500,
            CURLOPT_TIMEOUT_MS     => $wait ? 8000 : 2500,
            CURLOPT_NOSIGNAL       => 1,
            CURLOPT_HTTPHEADER     => array(
                'Authorization: Bearer ' . $key,
                'Content-Type: application/json',
                'Accept-Language: fr',
                'X-Pingsell-Source: prestashop',
                'User-Agent: Pingsell-PrestaShop/' . $this->version,
            ),
        ));
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
        return array(
            'code'  => $code,
            'body'  => is_string($res) ? $res : '',
            'error' => $err ?: (is_array($json) && isset($json['error']) ? $json['error'] : ($code ? 'HTTP ' . $code : '')),
        );
    }

    public function sendEvent($event, array $data)
    {
        if (empty($data['email']) || !Validate::isEmail($data['email'])) {
            return;
        }
        $data = array_filter(array_merge(array('event' => $event), $data), function ($v) {
            return $v !== null && $v !== '' && $v !== array();
        });
        try {
            $this->request('POST', '/events', $data);
        } catch (Exception $e) {
            // Never break the checkout.
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

    /** ps_emailsubscription (« Lettre d’informations » block). */
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

    /** Tracking number added after the « Expédié » status: send it again with the number. */
    public function hookActionAdminOrdersTrackingNumberUpdate($params)
    {
        if (!empty($params['order'])) {
            $this->sendShipment($params['order']);
        }
    }

    // ─── Signup form ──────────────────────────────────────────────────────────

    private function inbound()
    {
        $cached = Configuration::get('PINGSELL_INBOUND');
        $json = $cached ? json_decode($cached, true) : null;
        if (is_array($json) && isset($json['at']) && $json['at'] > time() - 86400) {
            return $json;
        }
        if (is_array($json) && !empty($json['failed_at']) && $json['failed_at'] > time() - 600) {
            return null;
        }
        $res = $this->request('GET', '/inbound');
        $json = $res['code'] === 200 ? json_decode($res['body'], true) : null;
        if (!is_array($json)) {
            // Unreachable or wrong key: don't retry on every page view (10 min).
            Configuration::updateValue('PINGSELL_INBOUND', json_encode(array('failed_at' => time())));
            return null;
        }
        $json['at'] = time();
        Configuration::updateValue('PINGSELL_INBOUND', json_encode($json));
        return $json;
    }

    public function hookDisplayFooterBefore($params)
    {
        if (!$this->enabled('PINGSELL_FOOTER_FORM')) {
            return '';
        }
        $inbound = $this->inbound();
        if (!$inbound || empty($inbound['form']['script_url'])) {
            return '';
        }
        return '<div class="container" style="margin:32px auto"><div data-pingsell-form data-tags="newsletter"></div></div>'
            . '<script src="' . htmlspecialchars($inbound['form']['script_url'], ENT_QUOTES, 'UTF-8') . '" async></script>';
    }

    // ─── Site tracking ────────────────────────────────────────────────────────

    /**
     * The Pingsell script on every page: pages and products seen. Logged-in customers, and the buyer on the
     * order confirmation page, are recognised straight away.
     */
    public function hookDisplayHeader($params)
    {
        if (!Configuration::get('PINGSELL_API_URL') || !Configuration::get('PINGSELL_API_KEY') || Configuration::get('PINGSELL_TRACKING') === '0') {
            return '';
        }
        $inbound = $this->inbound();
        if (!$inbound || empty($inbound['form']['script_url'])) {
            return '';
        }
        $email = '';
        $customer = $this->context->customer;
        if ($customer && $customer->isLogged() && Validate::isEmail($customer->email)) {
            $email = $customer->email;
        } elseif (isset($this->context->controller->php_self) && $this->context->controller->php_self === 'order-confirmation') {
            $order = new Order((int) Tools::getValue('id_order'));
            $buyer = Validate::isLoadedObject($order) ? new Customer((int) $order->id_customer) : null;
            if ($buyer && Validate::isLoadedObject($buyer) && $buyer->secure_key === (string) Tools::getValue('key')) {
                $email = $buyer->email;
            }
        }
        $out = '';
        if ($email !== '') {
            $out .= '<script>window.Pingsell=window.Pingsell||{q:[]};(Pingsell.q=Pingsell.q||[]).push(["identify",'
                . json_encode($email, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ']);</script>';
        }
        return $out . '<script src="' . htmlspecialchars($inbound['form']['script_url'], ENT_QUOTES, 'UTF-8') . '" async></script>';
    }
}

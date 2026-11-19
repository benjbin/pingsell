/**
 * Pingsell: captures the email typed at checkout (classic and block checkout) so an abandoned
 * cart can be relaunched. Only loaded when the merchant enabled carts and visit tracking.
 */
(function () {
	var cfg = window.pingsellCapture || {};
	if (!cfg.url || !window.fetch || !window.URLSearchParams) {
		return;
	}
	var last = '';

	function v(id) {
		var e = document.getElementById(id);
		return e ? e.value : '';
	}

	// WP Consent API, when installed: no capture without marketing consent.
	function allowed() {
		return typeof window.wp_has_consent !== 'function' || window.wp_has_consent('marketing');
	}

	function go() {
		var m = v('billing_email') || v('email'),
			f = v('billing_first_name') || v('billing-first_name') || v('shipping-first_name'),
			l = v('billing_last_name') || v('billing-last_name') || v('shipping-last_name'),
			k = m + '|' + f + '|' + l;
		if (!m || k === last || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) || !allowed()) {
			return;
		}
		last = k;
		var body = new URLSearchParams({ action: 'pingsell_capture', email: m, first_name: f, last_name: l });
		window.fetch(cfg.url, { method: 'POST', credentials: 'same-origin', body: body }).catch(function () {});
	}

	// Several fields change in a row (email, first name, last name, autofill): one call once they settle.
	var timer = null;
	function later(ms) {
		clearTimeout(timer);
		timer = setTimeout(go, ms);
	}

	document.addEventListener('change', function (e) {
		var id = (e.target && e.target.id) || '';
		if (/email|first|last/.test(id)) {
			later(1200);
		}
	}, true);
	// Before leaving the page, send what is filled in now.
	window.addEventListener('pagehide', function () {
		clearTimeout(timer);
		go();
	});
	later(1500);
})();

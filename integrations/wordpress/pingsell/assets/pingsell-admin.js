/** Pingsell settings page: asks before actions such as « Disconnect ». */
(function () {
	document.addEventListener('submit', function (e) {
		var form = e.target;
		var question = form && form.getAttribute && form.getAttribute('data-pingsell-confirm');
		if (question && !window.confirm(question)) {
			e.preventDefault();
		}
	}, true);
})();

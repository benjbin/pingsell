=== Pingsell ===
Contributors: pingsell
Tags: woocommerce, email marketing, abandoned cart, newsletter, automation
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.2.0
License: GPLv2 or later

Relie WordPress et WooCommerce à Pingsell : chaque inscription, panier, commande et expédition arrive dans Pingsell, qui envoie les bons emails au bon moment.

== Description ==

* Nouveaux comptes clients → contact Pingsell (tag « compte-client »).
* Paniers abandonnés WooCommerce, y compris les visiteurs non connectés (l’email est capté dès qu’il est saisi au paiement).
* Commandes (statut « En cours » ou « En attente ») → automatisations « Commande passée ».
* Commandes « Terminées » → « Commande expédiée », avec le numéro de suivi (Shipment Tracking, Advanced Shipment Tracking).
* Formulaires Contact Form 7, WPForms, Gravity Forms, Elementor Pro et Fluent Forms (option).
* Formulaire d’inscription prêt à l’emploi : [pingsell_form].
* Suivi des visites : pages et produits vus, clients connectés et acheteurs reconnus, pour les relances « Produit consulté sans achat » (option, activée par défaut).

Les envois partent en arrière-plan : la boutique n’est jamais ralentie, même si Pingsell est injoignable.

== Installation ==

1. Extensions › Ajouter › Téléverser l’extension, choisissez pingsell.zip, puis Activer.
2. Réglages › Pingsell : collez l’adresse de l’API et votre clé API (Pingsell › Intégrations › WordPress).
3. Cliquez sur « Tester la connexion ».

== Changelog ==

= 1.2.0 =
* Suivi des visites sur toutes les pages : pages et produits consultés, clients connectés et acheteurs reconnus automatiquement.

= 1.1.0 =
* Envois en file d’attente (Action Scheduler) : la boutique n’attend jamais Pingsell.
* Un panier devenu commande garde le même numéro : pas de double relance.
* Noms lus correctement (WPForms, Gravity Forms, Fluent Forms, paiement en blocs).
* Compatibilité déclarée avec le paiement en blocs.

= 1.0.0 =
* Première version.

# Politique de réponse aux incidents de sécurité

Un incident = tout accès, perte, modification ou divulgation non autorisée de données personnelles (contacts, comptes marchands), ou une faille qui le rend possible.

Responsable : Neokrome (contact@neokrome.tech). Ce document est relu une fois par an et après chaque incident.

## 1. Détecter

Sources : alertes du serveur et de Coolify, journaux de l'API, journal des accès aux données (`data_access_log`), signalement d'un marchand, d'un chercheur ou de Shopify.
Tout signalement reçoit une réponse sous 24 h.

## 2. Contenir (dans l'heure)

- Couper l'accès en cause : révoquer les sessions et clés API concernées, changer les secrets (Coolify, Shopify, S3, clé de sauvegarde si besoin), bloquer l'IP.
- Si le serveur est compromis : l'isoler, garder une copie du disque pour l'analyse, redéployer sur un serveur neuf depuis le dépôt et la dernière sauvegarde saine.

## 3. Évaluer

Quelles données, quels comptes, combien de personnes, depuis quand. S'appuyer sur `data_access_log`, les journaux d'accès et les sauvegardes datées.
Tout noter dans un rapport d'incident (chronologie, causes, données touchées, actions).

## 4. Notifier

- Marchands concernés : sans retard injustifié, avec ce qui s'est passé, les données touchées et ce qu'ils doivent faire.
- Shopify : via le Partner Dashboard / l'adresse de contact de Shopify, pour toute donnée venant de Shopify.
- CNIL : sous 72 h si l'incident présente un risque pour les personnes (RGPD, art. 33) ; les personnes elles-mêmes si le risque est élevé (art. 34).

## 5. Corriger et tirer les leçons

Corriger la cause, vérifier qu'elle ne peut pas revenir, restaurer depuis une sauvegarde si des données ont été perdues ou altérées ([sauvegardes.md](sauvegardes.md)), puis mettre à jour ce document et les procédures.

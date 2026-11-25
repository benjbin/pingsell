# Prévention des fuites de données

But : empêcher qu'une personne malveillante, de l'extérieur ou de l'intérieur, sorte les données personnelles des contacts (nom, email, téléphone). Cette stratégie combine des contrôles techniques et des règles.

## Contrôles techniques

- **Cloisonnement par compte** : chaque requête est limitée au compte de l'utilisateur connecté ou de la clé API ; un marchand ne voit jamais les contacts d'un autre.
- **Pas d'export de masse dans l'app** : aucune fonction de téléchargement de la base de contacts ; la liste des contacts est paginée.
- **Accès restreints** : rôles (propriétaire, membres), page « Administration » réservée à `PLATFORM_ADMIN_EMAILS`, API joignable seulement via le service `web` sur le réseau Docker interne.
- **Chiffrement** : HTTPS en transit ; volume de données chiffré LUKS2 ([chiffrement-volume.md](chiffrement-volume.md)) ; sauvegardes chiffrées AES-256-GCM ([sauvegardes.md](sauvegardes.md)).
- **Journal des accès** : chaque consultation, modification, import ou suppression de contacts est enregistrée (`data_access_log` : qui, quoi, quand, IP), lisible via `GET /api/v1/admin/data-access`, gardée 1 an.
- **Limitation des abus** : limites de débit sur les points d'entrée publics (formulaires, connexion boutique).
- **Minimum de données** : seuls nom, email et téléphone sont lus depuis Shopify ; aucune adresse postale.

## Règles

- Aucune donnée de contact ne sort de la production : pas de copie sur un poste, une messagerie ou un outil tiers ; tests et démos sur des données fictives.
- Accès au serveur, à Coolify et aux secrets limité au fondateur, par clé SSH ou mot de passe unique avec double authentification ; retiré dès qu'il n'est plus nécessaire.
- Le journal des accès est relu une fois par mois et à chaque signalement : volume anormal de lectures, IP inconnue, compte inhabituel.
- Tout soupçon de fuite déclenche la [politique de réponse aux incidents](incidents.md).

Ce document est relu une fois par an et après chaque incident.

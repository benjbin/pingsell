# Sécurité et protection des données

Comment Pingsell protège les données personnelles des contacts (clients des marchands) : ce qui est dans le code, et ce qu'il faut faire sur le serveur. Ce document sert aussi de réponse aux questions « protected customer data » de Shopify.

| Exigence | Comment c'est couvert |
|---|---|
| Minimum de données | Shopify : `read_customers`, `read_orders` seulement. Nom, e-mail, téléphone ; aucune adresse postale. |
| Chiffrement en transit | HTTPS partout (certificat géré par Coolify). L'API n'est joignable que par le service `web`, sur le réseau Docker interne. |
| Chiffrement au repos | Volume de données (base + images + sauvegardes) chiffré en LUKS2 AES-256-XTS : [chiffrement-volume.md](chiffrement-volume.md). |
| Sauvegardes chiffrées | Sauvegarde quotidienne AES-256-GCM, 14 gardées, copie hors serveur sur S3 : [sauvegardes.md](sauvegardes.md). |
| Prévention de la perte de données | Sauvegardes quotidiennes hors serveur + procédure de restauration testée : [sauvegardes.md](sauvegardes.md). |
| Données de test séparées | Les tests et démos tournent sur une base locale (`missive.db`) avec des données fictives ; la production a son propre volume. |
| Rétention | `customers/redact` : le client est supprimé. `shop/redact` (48 h après la désinstallation) : paniers, demandes, lien et jetons de la boutique supprimés. Compte Pingsell supprimé : tous ses contacts supprimés. Sauvegardes : 14 jours sur le serveur, 30 jours sur S3. Journal des accès : 1 an. |
| Consentement | Statut d'abonnement par contact, lien de désinscription dans chaque email, désinscriptions et plaintes jamais recontactées. |
| Accès du personnel | Rôles dans l'app (propriétaire, membres). Page « Administration » réservée à `PLATFORM_ADMIN_EMAILS`. Règle : accès au serveur et à Coolify limité aux personnes qui en ont besoin, par clé SSH, et retiré dès qu'elles n'en ont plus besoin. |
| Mots de passe | Mots de passe de l'app hachés avec scrypt. Règle pour l'équipe : mot de passe unique et long (gestionnaire de mots de passe) et double authentification sur Coolify, GitHub, Shopify Partners, l'hébergeur et le stockage S3. |
| Journal des accès | Table `data_access_log` : chaque consultation, modification, import ou suppression de contacts (qui, quoi, quand, IP). Lecture : `GET /api/v1/admin/data-access`. |
| Réponse aux incidents | [incidents.md](incidents.md). |

Contact sécurité : contact@neokrome.tech

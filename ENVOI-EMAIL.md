# Envoi des emails par notre propre serveur

Pingsell envoie ses emails lui-même, sans service tiers (ni Amazon SES, ni Brevo, ni Mailgun).

## Comment ça marche

```
API ──(port 2525, interne)──▶ mta (Postfix + DKIM) ──(port 25)──▶ Gmail, Outlook, Orange…
                                     ▲
     rebonds et plaintes ──(port 25)─┘──▶ POST /webhooks/mta ──▶ API
```

- L'API confie chaque email au conteneur `mta` (`apps/mta`). Celui-ci le signe en DKIM et le livre directement au serveur du destinataire.
- Chaque email part avec une adresse de retour unique : `bounces+<id du message>@pingsell.neokrome.tech`. Les rebonds et les plaintes reviennent sur le serveur, qui les transmet à l'API :
  - **adresse inexistante** (rebond définitif) : le message passe en `bounced` et le contact aussi. Il ne recevra plus rien.
  - **plainte pour spam** : le contact passe en `complained`. C'est définitif.
  - **refus temporaire, ou blocage anti-spam (5.7.x)** : le message est marqué en échec, mais le contact n'est pas touché, car ce n'est pas son adresse qui pose problème.
- **Expéditeur :** un email ne peut être signé que pour notre domaine. Si une boutique a choisi l'expéditeur `hello@sa-boutique.fr`, l'email part de `bonjour@pingsell.neokrome.tech` avec le nom de la boutique, et `hello@sa-boutique.fr` est mis en adresse de réponse (Reply-To). Les réponses arrivent donc bien à la boutique.
- **Désabonnement en un clic** (`List-Unsubscribe`) et en-tête `Feedback-ID` : ce sont les deux exigences de Gmail et Yahoo pour les envois en masse.

## 1. Côté serveur (OVH, IP 162.19.72.27)

1. **Port 25 sortant.** En SSH sur le serveur :
   ```bash
   nc -vz -w 5 gmail-smtp-in.l.google.com 25
   ```
   Le résultat doit afficher `succeeded`. Sinon, demande l'ouverture du port au support OVH.
2. **Port 25 libre sur la machine.** Si `ss -ltnp | grep ':25 '` affiche quelque chose (souvent un Postfix ou un Exim installé avec le système), il faut l'arrêter pour laisser la place au conteneur :
   ```bash
   systemctl disable --now postfix
   ```
3. **Reverse DNS (PTR).** Espace client OVH → Bare Metal Cloud → ton serveur → IP → « ⋯ » à côté de 162.19.72.27 → **Modifier le reverse**, et mettre `mail.pingsell.neokrome.tech`. Fais-le **après** avoir créé l'enregistrement A de l'étape 2 : OVH vérifie qu'il existe.

## 2. Zone DNS de neokrome.tech

À créer dans la zone DNS (chez OVH). Ça ne touche pas aux emails de `neokrome.tech` lui-même, seulement au sous-domaine `pingsell`.

| Type | Nom | Valeur |
|---|---|---|
| A | `mail.pingsell` | `162.19.72.27` |
| MX | `pingsell` | `10 mail.pingsell.neokrome.tech.` |
| TXT | `pingsell` | `v=spf1 ip4:162.19.72.27 -all` |
| TXT | `mail.pingsell` | `v=spf1 a -all` |
| TXT | `pingsell._domainkey.pingsell` | **valeur affichée dans les logs du service `mta`** (commence par `v=DKIM1; h=sha256; k=rsa; p=…`) |
| TXT | `_dmarc.pingsell` | `v=DMARC1; p=none; adkim=s; aspf=s; rua=mailto:dmarc@pingsell.neokrome.tech` |

La clé DKIM est générée au premier démarrage du conteneur `mta`, puis conservée dans le volume `mta-data`. Pour la retrouver : Coolify → service `mta` → **Logs**, sur les lignes `[mta]`. Ne supprime pas ce volume : une nouvelle clé obligerait à changer le DNS.

Après quelques semaines d'envois propres, passe le DMARC en `p=quarantine`.

## 3. Coolify

Après le redéploiement, le service `mta` apparaît dans la liste. Aucune variable n'est obligatoire :

| Variable | Défaut | Rôle |
|---|---|---|
| `MAIL_DOMAIN` | `pingsell.neokrome.tech` | Domaine d'envoi |
| `MAIL_FROM_EMAIL` | `bonjour@<MAIL_DOMAIN>` | Expéditeur par défaut |
| `MTA_WEBHOOK_SECRET` | généré par Coolify | Secret partagé entre l'API et `mta` |
| `MAIL_WARMUP_START` | vide (sans limite) | **À remplir** avec le premier jour d'envoi (`2026-11-20` par exemple) |
| `MAIL_WARMUP_INITIAL` / `MAIL_WARMUP_GROWTH` / `MAIL_WARMUP_MAX` | `200` / `1.4` / `100000` | Plafond du jour 1, croissance quotidienne, plafond final |
| `EMAIL_PROVIDER` | `smtp` | `log` = rien ne part (tests) ; `ses` reste possible |

## 4. Warm-up : faire monter l'IP en douceur

Une IP neuve qui envoie des milliers d'emails dès le premier jour finit en spam. Avec `MAIL_WARMUP_START` renseigné, le worker plafonne le volume quotidien :

- avec les valeurs par défaut, environ 200 emails le jour 1, 390 le jour 3, 1 500 le jour 7, 11 000 le jour 13 et 100 000 vers le jour 20 ;
- au-delà du plafond, les emails restent en file et partent le lendemain. Rien n'est perdu.

Pendant ces premières semaines, envoie d'abord aux contacts **les plus engagés** (clients récents, abonnés actifs).

## 5. Vérifier

- **Logs du service `mta` :** une ligne `status=sent (250 …)` par email livré.
- **[mail-tester.com](https://www.mail-tester.com) :** envoie un email de test de campagne à l'adresse fournie par le site. Vise 9/10 ou plus, avec SPF, DKIM et DMARC « pass ».
- **Dans Gmail :** ouvre un email reçu, puis « ⋮ » → **Afficher l'original**. On doit lire `SPF: PASS`, `DKIM: PASS` et `DMARC: PASS`.
- **[Google Postmaster Tools](https://postmaster.google.com) :** ajoute `pingsell.neokrome.tech` pour suivre la réputation du domaine et le taux de plaintes, qui doit rester sous 0,1 %.

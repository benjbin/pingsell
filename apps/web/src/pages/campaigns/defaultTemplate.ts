/** Starter template for new campaigns: table-based, inline styles, responsive. */
export const DEFAULT_EMAIL_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pingsell</title>
</head>
<body style="margin:0;padding:0;background:#f4f2fb;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2fb;padding:32px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:#0E0E0C;padding:28px 32px;color:#ffffff;font-size:20px;font-weight:bold;">
            Votre marque
          </td>
        </tr>
        <tr>
          <td style="padding:32px;color:#0f172a;font-size:16px;line-height:1.6;">
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;color:#0f172a;">Bonjour {{first_name}},</h1>
            <p style="margin:0 0 16px;">Écrivez ici votre message. Présentez votre offre, votre nouveauté ou votre actualité en quelques phrases.</p>
            <p style="margin:0 0 28px;">Ou partez d'un de nos modèles prêts à l'emploi.</p>
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:10px;background:#0E0E0C;">
                  <a href="https://exemple.fr" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;">Découvrir</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5;text-align:center;">
            Vous recevez cet email car vous êtes inscrit à notre newsletter.<br>
            <a href="{{unsubscribe_url}}" style="color:#0E0E0C;">Se désabonner</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

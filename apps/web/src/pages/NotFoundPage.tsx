import { Link } from "react-router";
import { Compass } from "lucide-react";
import { Button, Card, EmptyState } from "../components/ui/primitives";
import { t } from "../lib/i18n";

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title={t("Page introuvable", "Page not found")}
        description={t("La page que vous cherchez n'existe pas ou a été déplacée.", "The page you're looking for doesn't exist or has been moved.")}
        action={
          <Link to="/">
            <Button>{t("Retour au tableau de bord", "Back to dashboard")}</Button>
          </Link>
        }
      />
    </Card>
  );
}

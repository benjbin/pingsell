import { Link } from "react-router";
import { Compass } from "lucide-react";
import { Button, Card, EmptyState } from "../components/ui/primitives";

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={Compass}
        title="Page introuvable"
        description="La page que vous cherchez n'existe pas ou a été déplacée."
        action={
          <Link to="/">
            <Button>Retour au tableau de bord</Button>
          </Link>
        }
      />
    </Card>
  );
}

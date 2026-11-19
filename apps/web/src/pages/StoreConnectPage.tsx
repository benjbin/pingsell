import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { ArrowRight, CircleAlert, Store, TriangleAlert } from "lucide-react";
import { connectAuthorize, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Spinner } from "../components/ui/primitives";
import { AuthShell } from "./AuthPage";
import { t } from "../lib/i18n";
import {
  PLATFORM_LABELS,
  cancelRedirectUrl,
  clearPendingStoreConnect,
  parseHttpUrl,
  parseStoreConnectParams,
  savePendingStoreConnect,
  storeConnectPath,
  type StoreConnectError,
  type StoreConnectRequest,
} from "../lib/storeConnect";

/**
 * Landing page of the "Connect to Pingsell" button in the WordPress and PrestaShop plugins.
 * Reachable signed in or not: the merchant logs in (or signs up), confirms, and goes back to the
 * plugin with a one-time code that the plugin exchanges for its API key.
 */
export function StoreConnectPage() {
  const location = useLocation();
  const { account, initializing, bootError, retryBoot } = useAuth();
  const parsed = parseStoreConnectParams(location.search);
  const self = storeConnectPath(location.search);

  // Survives the login / sign-up round trip (and the welcome flow after a sign-up).
  useEffect(() => {
    if (parsed.ok) savePendingStoreConnect(self);
    else clearPendingStoreConnect();
  }, [parsed.ok, self]);

  return (
    <AuthShell>
      <div className="mx-auto flex w-full max-w-[440px] flex-1 animate-rise flex-col justify-center py-12">
        {!parsed.ok ? (
          <InvalidLink error={parsed.error} />
        ) : initializing ? (
          <Spinner className="mx-auto size-7" />
        ) : !account && bootError ? (
          <div className="text-center">
            <p className="text-[15px] text-slate-600 dark:text-slate-400">{bootError}</p>
            <Button className="mt-6" onClick={retryBoot}>
              {t("Réessayer", "Try again")}
            </Button>
          </div>
        ) : account ? (
          <LinkStore request={parsed.request} />
        ) : (
          <SignInFirst request={parsed.request} from={self} />
        )}
      </div>
    </AuthShell>
  );
}

function Badge() {
  return (
    <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-900/30">
      <Store className="size-6" strokeWidth={1.75} />
    </span>
  );
}

function cancel(request: StoreConnectRequest) {
  clearPendingStoreConnect();
  const url = cancelRedirectUrl(request.returnUrl, request.state);
  if (url) window.location.assign(url);
}

function CancelButton({ request }: { request: StoreConnectRequest }) {
  return (
    <button type="button" onClick={() => cancel(request)} className="font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
      {t("Annuler", "Cancel")}
    </button>
  );
}

/** Not signed in: create an account or log in, then come back here. */
function SignInFirst({ request, from }: { request: StoreConnectRequest; from: string }) {
  const state = { from };
  const platform = PLATFORM_LABELS[request.platform];
  return (
    <div>
      <Badge />
      <h1 className="display mt-6 text-[40px] leading-[0.92] text-slate-900 dark:text-white">
        {t(
          <>
            Plus qu'une étape pour connecter votre <em className="text-brand-500">boutique {platform}.</em>
          </>,
          <>
            One more step to connect your <em className="text-brand-500">{platform} store.</em>
          </>,
        )}
      </h1>
      <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
        {t(
          <>
            Créez votre compte Pingsell ou connectez-vous : vous pourrez ensuite relier <span className="font-semibold text-slate-900 dark:text-white break-words">{request.siteHost}</span> en un clic.
          </>,
          <>
            Create your Pingsell account or log in, then link <span className="font-semibold text-slate-900 dark:text-white break-words">{request.siteHost}</span> in one click.
          </>,
        )}
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <Link to="/inscription" state={state}>
          <Button size="lg" className="group w-full">
            {t("Créer mon compte Pingsell", "Create my Pingsell account")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
        <Link to="/connexion" state={state}>
          <Button size="lg" variant="secondary" className="w-full">
            {t("J'ai déjà un compte", "I already have an account")}
          </Button>
        </Link>
      </div>
      <div className="mt-5 text-sm">
        <CancelButton request={request} />
      </div>
    </div>
  );
}

/** Signed in: confirm, then go back to the plugin with the one-time code. */
function LinkStore({ request }: { request: StoreConnectRequest }) {
  const { account, canManage, logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const platform = PLATFORM_LABELS[request.platform];

  async function link() {
    setError(null);
    setLoading(true);
    try {
      const { redirect } = await connectAuthorize({
        platform: request.platform,
        site: request.site,
        return_url: request.returnUrl,
        state: request.state,
      });
      if (!parseHttpUrl(redirect)) throw new Error(t("Réponse inattendue du serveur. Réessayez.", "Unexpected server response. Please try again."));
      clearPendingStoreConnect();
      window.location.assign(redirect);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <div>
      <Badge />
      <h1 className="display mt-6 text-[36px] leading-[0.95] text-slate-900 dark:text-white">
        {t(
          <>
            Relier votre boutique <em className="text-brand-500 break-words">{request.siteHost}</em> à Pingsell ?
          </>,
          <>
            Link your store <em className="text-brand-500 break-words">{request.siteHost}</em> to Pingsell?
          </>,
        )}
      </h1>
      <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
        {t(
          <>
            Relier votre boutique <span className="font-semibold text-slate-900 dark:text-white break-words">{request.siteHost}</span> ({platform}) à votre compte Pingsell « <span className="font-semibold text-slate-900 dark:text-white">{account?.name}</span> » ? Vos clients, leurs commandes et les paniers abandonnés arriveront tout seuls.
          </>,
          <>
            Link your store <span className="font-semibold text-slate-900 dark:text-white break-words">{request.siteHost}</span> ({platform}) to your Pingsell account “<span className="font-semibold text-slate-900 dark:text-white">{account?.name}</span>”? Your customers, their orders and abandoned carts will flow in on their own.
          </>,
        )}
      </p>
      <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
        {t("Vous serez ensuite renvoyé vers ", "You'll then be sent back to ")}
        <span className="font-semibold text-slate-900 break-all dark:text-white">{request.returnHost}</span>
        {t(", l'administration de votre boutique.", ", your store's admin.")}
      </p>

      {!canManage && (
        <p className="mt-6 flex gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {t(
              "Seuls le propriétaire et les administrateurs du compte peuvent relier une boutique. Demandez-leur, ou utilisez un autre compte.",
              "Only the account owner and admins can link a store. Ask them, or use another account.",
            )}
          </span>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-red-300 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
          {error}
        </p>
      )}

      <Button size="lg" className="group mt-8 w-full" loading={loading} disabled={!canManage} onClick={() => void link()}>
        {t("Relier la boutique", "Link the store")}
        {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
      </Button>
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
        {/* Stays on this page: once signed out, it offers to log in or sign up, with the request kept. */}
        <button type="button" onClick={logout} className="font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
          {t("Utiliser un autre compte", "Use another account")}
        </button>
        <CancelButton request={request} />
      </div>
    </div>
  );
}

const ERRORS: Record<StoreConnectError, string> = {
  platform: t("La plateforme de la boutique n'est pas reconnue.", "The store platform isn't recognised."),
  site: t("L'adresse de la boutique est manquante ou invalide.", "The store address is missing or invalid."),
  return_url: t("L'adresse de retour vers votre boutique est manquante ou invalide.", "The return address to your store is missing or invalid."),
  state: t("Le lien de connexion est incomplet.", "The connection link is incomplete."),
  host_mismatch: t("L'adresse de retour ne correspond pas à la boutique.", "The return address doesn't match the store."),
};

function InvalidLink({ error }: { error: StoreConnectError }) {
  const { account } = useAuth();
  return (
    <div className="text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/30">
        <CircleAlert className="size-6" />
      </span>
      <h1 className="display mt-5 text-[34px] leading-[0.95] text-slate-900 dark:text-white">{t("Lien invalide", "Invalid link")}</h1>
      <p role="alert" className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
        {ERRORS[error]}{" "}
        {t("Recommencez depuis l'administration de votre boutique, avec le bouton « Connecter à Pingsell ».", "Start again from your store's admin, with the “Connect to Pingsell” button.")}
      </p>
      <Link
        to={account ? "/integrations" : "/connexion"}
        className="mt-8 inline-block font-medium text-slate-950 underline decoration-brand-500 decoration-2 underline-offset-4 dark:text-white"
      >
        {account ? t("Aller aux intégrations", "Go to integrations") : t("Se connecter à Pingsell", "Log in to Pingsell")}
      </Link>
    </div>
  );
}

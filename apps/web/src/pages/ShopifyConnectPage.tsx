import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, CircleAlert, ShoppingBag, TriangleAlert } from "lucide-react";
import { ApiError, api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { Button, Spinner } from "../components/ui/primitives";
import { AuthShell } from "./AuthPage";
import { t } from "../lib/i18n";
import { SHOPIFY_CONNECT_PATH, clearPendingClaim, getPendingClaim, savePendingClaim } from "../lib/shopifyClaim";

/**
 * Landing page after a Shopify install whose shop isn't linked to a Pingsell account yet.
 * Reachable signed in or not: the merchant logs in (or signs up), then confirms, and the shop is attached.
 */
export function ShopifyConnectPage() {
  const [params] = useSearchParams();
  const { account, initializing, bootError, retryBoot } = useAuth();
  const claim = params.get("claim") || getPendingClaim();

  // Survives the login / sign-up round trip (and the welcome flow after a sign-up).
  useEffect(() => {
    const fromUrl = params.get("claim");
    if (fromUrl) savePendingClaim(fromUrl);
  }, [params]);

  return (
    <AuthShell>
      <div className="mx-auto flex w-full max-w-[440px] flex-1 animate-rise flex-col justify-center py-12">
        {initializing ? (
          <Spinner className="mx-auto size-7" />
        ) : !claim ? (
          <Expired />
        ) : !account && bootError ? (
          <div className="text-center">
            <p className="text-[15px] text-slate-600 dark:text-slate-400">{bootError}</p>
            <Button className="mt-6" onClick={retryBoot}>
              {t("Réessayer", "Try again")}
            </Button>
          </div>
        ) : account ? (
          <ClaimShop claim={claim} />
        ) : (
          <SignInFirst claim={claim} />
        )}
      </div>
    </AuthShell>
  );
}

function Badge() {
  return (
    <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-900/30">
      <ShoppingBag className="size-6" strokeWidth={1.75} />
    </span>
  );
}

/** Not signed in: create an account or log in, then come back here. */
function SignInFirst({ claim }: { claim: string }) {
  const state = { from: `${SHOPIFY_CONNECT_PATH}?claim=${encodeURIComponent(claim)}` };
  return (
    <div>
      <Badge />
      <h1 className="display mt-6 text-[40px] leading-[0.92] text-slate-900 dark:text-white">
        {t(
          <>
            Plus qu'une étape pour connecter votre <em className="text-brand-500">boutique Shopify.</em>
          </>,
          <>
            One more step to connect your <em className="text-brand-500">Shopify store.</em>
          </>,
        )}
      </h1>
      <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
        {t(
          "Pingsell est installé sur votre boutique. Créez votre compte ou connectez-vous : la boutique y sera rattachée aussitôt.",
          "Pingsell is installed on your store. Create your account or log in, and the store will be linked to it right away.",
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
    </div>
  );
}

/** Signed in: show the shop and attach it on confirmation. */
function ClaimShop({ claim }: { claim: string }) {
  const navigate = useNavigate();
  const { account, logout } = useAuth();
  const pending = useAsync(async () => {
    try {
      return await api.integrations.shopify.pending(claim);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [claim]);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending.data === null) clearPendingClaim();
  }, [pending.data]);

  async function connect() {
    setError(null);
    setLoading(true);
    try {
      await api.integrations.shopify.claim(claim);
      clearPendingClaim();
      navigate("/integrations?shopify=connected", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        clearPendingClaim();
        setExpired(true);
      } else setError(errorMessage(err));
      setLoading(false);
    }
  }

  function later() {
    clearPendingClaim();
    navigate("/", { replace: true });
  }

  // Stays on this page: once signed out, it offers to log in or sign up, with the claim kept.
  const switchAccount = logout;

  if (pending.loading && pending.data === undefined) return <Spinner className="mx-auto size-7" />;
  if (expired || pending.data === null) return <Expired />;
  if (pending.error || !pending.data) {
    return (
      <div className="text-center">
        <p className="text-[15px] text-slate-600 dark:text-slate-400">{pending.error}</p>
        <Button className="mt-6" onClick={() => void pending.reload()}>
          {t("Réessayer", "Try again")}
        </Button>
      </div>
    );
  }

  const shop = pending.data;
  const shopLabel = shop.shop_name || shop.shop_domain;
  const replaces = shop.current_shop && shop.current_shop !== shop.shop_domain ? shop.current_shop : null;

  return (
    <div>
      <Badge />
      <h1 className="display mt-6 text-[36px] leading-[0.95] text-slate-900 dark:text-white">
        {t(
          <>
            Connecter la boutique <em className="text-brand-500 break-words">{shopLabel}</em> à votre compte Pingsell
          </>,
          <>
            Connect the store <em className="text-brand-500 break-words">{shopLabel}</em> to your Pingsell account
          </>,
        )}
      </h1>
      <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
        {t(
          <>
            Compte : <span className="font-semibold text-slate-900 dark:text-white">{account?.name}</span>. Vos clients, leurs commandes et les paniers abandonnés arriveront tout seuls.
          </>,
          <>
            Account: <span className="font-semibold text-slate-900 dark:text-white">{account?.name}</span>. Your customers, their orders and abandoned carts will flow in on their own.
          </>,
        )}
      </p>
      {shop.shop_name && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{shop.shop_domain}</p>}

      {replaces && (
        <p className="mt-6 flex gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {t(
              <>
                Elle remplacera la boutique <span className="font-semibold">{replaces}</span>, connectée aujourd'hui à ce compte. Les contacts déjà importés sont conservés.
              </>,
              <>
                It will replace <span className="font-semibold">{replaces}</span>, the store currently connected to this account. Contacts already imported are kept.
              </>,
            )}
          </span>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-red-300 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
          {error}
        </p>
      )}

      <Button size="lg" className="group mt-8 w-full" loading={loading} onClick={() => void connect()}>
        {t("Connecter la boutique", "Connect the store")}
        {!loading && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />}
      </Button>
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
        <button type="button" onClick={switchAccount} className="font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
          {t("Utiliser un autre compte", "Use another account")}
        </button>
        <button type="button" onClick={later} className="font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
          {t("Pas maintenant", "Not now")}
        </button>
      </div>
    </div>
  );
}

function Expired() {
  const { account } = useAuth();
  return (
    <div className="text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/30">
        <CircleAlert className="size-6" />
      </span>
      <h1 className="display mt-5 text-[34px] leading-[0.95] text-slate-900 dark:text-white">{t("Lien expiré", "Link expired")}</h1>
      <p className="mt-4 text-[15px] text-slate-600 dark:text-slate-400">
        {t("Ce lien a expiré. Relancez l'installation depuis Shopify.", "This link has expired. Start the install again from Shopify.")}
      </p>
      <Link
        to={account ? "/integrations?outil=shopify" : "/connexion"}
        state={account ? undefined : { from: "/integrations?outil=shopify" }}
        className="mt-8 inline-block font-medium text-slate-950 underline decoration-brand-500 decoration-2 underline-offset-4 dark:text-white"
      >
        {t("Aller à l'intégration Shopify", "Go to the Shopify integration")}
      </Link>
    </div>
  );
}

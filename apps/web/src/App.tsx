import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./components/ui/Toast";
import { WifiOff } from "lucide-react";
import { Button, Spinner } from "./components/ui/primitives";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ContactsPage } from "./pages/contacts/ContactsPage";
import { SegmentsPage } from "./pages/segments/SegmentsPage";
import { SegmentEditorPage } from "./pages/segments/SegmentEditorPage";
import { CampaignsPage } from "./pages/campaigns/CampaignsPage";
import { CampaignEditorPage } from "./pages/campaigns/CampaignEditorPage";
import { CampaignReportPage } from "./pages/campaigns/CampaignReportPage";
import { AutomationsPage } from "./pages/automations/AutomationsPage";
import { AutomationEditorPage } from "./pages/automations/AutomationEditorPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { OutboxPage } from "./pages/OutboxPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

function ApiUnreachable({ message, onRetry, onLogout }: { message: string; onRetry: () => void; onLogout: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
          <WifiOff className="size-6" />
        </span>
        <h1 className="mt-4 display text-[26px] leading-tight text-slate-950 dark:text-white">API injoignable</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" onClick={onLogout}>
            Se déconnecter
          </Button>
          <Button onClick={onRetry}>Réessayer</Button>
        </div>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { account, initializing, bootError, retryBoot, logout } = useAuth();
  const location = useLocation();
  if (initializing) return <FullScreenLoader />;
  if (!account && bootError) return <ApiUnreachable message={bootError} onRetry={retryBoot} onLogout={logout} />;
  if (!account) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  return children;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { account, initializing, bootError } = useAuth();
  if (initializing) return <FullScreenLoader />;
  if (account || bootError) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/connexion" element={<GuestOnly><AuthPage mode="login" /></GuestOnly>} />
              <Route path="/inscription" element={<GuestOnly><AuthPage mode="register" /></GuestOnly>} />
              <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route index element={<DashboardPage />} />
                <Route path="contacts" element={<ContactsPage />} />
                <Route path="segments" element={<SegmentsPage />} />
                <Route path="segments/nouveau" element={<SegmentEditorPage />} />
                <Route path="segments/:id" element={<SegmentEditorPage />} />
                <Route path="campagnes" element={<CampaignsPage />} />
                <Route path="campagnes/nouvelle" element={<CampaignEditorPage />} />
                <Route path="campagnes/:id" element={<CampaignEditorPage />} />
                <Route path="campagnes/:id/rapport" element={<CampaignReportPage />} />
                <Route path="automatisations" element={<AutomationsPage />} />
                <Route path="automatisations/nouvelle" element={<AutomationEditorPage />} />
                <Route path="automatisations/:id" element={<AutomationEditorPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="boite-envoi" element={<OutboxPage />} />
                <Route path="parametres" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

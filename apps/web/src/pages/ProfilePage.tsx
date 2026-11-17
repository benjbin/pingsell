import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Clock, Crown, LogOut, Mail, PenLine, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { cx, formatDate, formatRelative } from "../lib/format";
import type { Invitation, Role, User } from "../lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Select, Skeleton } from "../components/ui/primitives";
import { ConfirmModal, Modal } from "../components/ui/Overlay";
import { useToast } from "../components/ui/Toast";
import { CopyButton } from "../components/CopyButton";

export const ROLES: Record<Role, { label: string; description: string; icon: typeof Crown; tone: "brand" | "blue" | "slate" }> = {
  owner: { label: t("Propriétaire", "Owner"), description: t("Accès complet, ne peut pas être retiré.", "Full access; can't be removed."), icon: Crown, tone: "brand" },
  admin: {
    label: t("Administrateur", "Admin"),
    description: t("Tout gérer : campagnes, contacts, intégrations, clés API et équipe.", "Manage everything: campaigns, contacts, integrations, API keys and team."),
    icon: Shield, tone: "blue" },
  editor: {
    label: t("Éditeur", "Editor"),
    description: t(
      "Créer et envoyer des campagnes, gérer contacts, segments et automatisations. Pas d'accès à l'équipe ni aux clés API.",
      "Create and send campaigns, manage contacts, segments and automations. No access to the team or API keys.",
    ),
    icon: PenLine, tone: "slate" },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function PersonAvatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-slate-900 font-display font-extrabold text-white dark:bg-white dark:text-slate-900",
        size === "lg" ? "size-16 text-xl" : "size-10 text-sm",
      )}
    >
      {initials(name)}
    </span>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const r = ROLES[role];
  return (
    <Badge tone={r.tone}>
      <r.icon className="size-3" /> {r.label}
    </Badge>
  );
}

// --- Personal information ------------------------------------------------------------

function ProfileCard({ user }: { user: User }) {
  const toast = useToast();
  const { setUser, refresh } = useAuth();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== user.name || email.trim().toLowerCase() !== user.email;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const u = await api.profile.update({ name: name.trim(), email: email.trim() });
      setUser(u);
      setName(u.name);
      setEmail(u.email);
      await refresh().catch(() => undefined);
      toast.success(t("Profil mis à jour", "Profile updated"));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={t("Informations personnelles", "Personal information")}
        description={t("Votre nom apparaît auprès de l'équipe ; l'email sert à vous connecter.", "Your name is shown to your team; your email is used to sign in.")}
      />
      <form onSubmit={save} className="grid gap-4 p-6 sm:grid-cols-2">
        <Field label={t("Nom complet", "Full name")} htmlFor="p-name">
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </Field>
        <Field label={t("Email de connexion", "Sign-in email")} htmlFor="p-email">
          <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={saving} disabled={!dirty}>
            {t("Enregistrer", "Save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    setSaving(true);
    try {
      await api.profile.changePassword({ current, next });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t("Mot de passe modifié", "Password changed"), t("Vos autres sessions ont été déconnectées.", "You've been signed out of your other sessions."));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t("Mot de passe", "Password")} description={t("Changer de mot de passe déconnecte vos autres appareils.", "Changing your password signs out your other devices.")} />
      <form onSubmit={save} className="grid gap-4 p-6 sm:grid-cols-3">
        <Field label={t("Mot de passe actuel", "Current password")} htmlFor="pw-current">
          <Input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Field label={t("Nouveau mot de passe", "New password")} htmlFor="pw-next" hint={t("8 caractères minimum.", "At least 8 characters.")}>
          <Input id="pw-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label={t("Confirmation", "Confirm password")} htmlFor="pw-confirm" error={mismatch ? t("Les mots de passe ne correspondent pas", "Passwords don't match") : undefined}>
          <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" loading={saving} disabled={!current || next.length < 8 || mismatch}>
            {t("Changer le mot de passe", "Change password")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AccountCard() {
  const toast = useToast();
  const { account, canManage, setAccount } = useAuth();
  const [name, setName] = useState(account?.name ?? "");
  const [saving, setSaving] = useState(false);
  if (!account) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      setAccount(await api.account.rename(name.trim()));
      toast.success(t("Nom de la boutique mis à jour", "Store name updated"));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={t("Boutique", "Store")} description={t("Le nom utilisé par défaut comme expéditeur et dans vos emails.", "The default sender name, also used in your emails.")} />
      <form onSubmit={save} className="flex flex-wrap items-end gap-3 p-6">
        <Field label={t("Nom de la boutique ou de l'entreprise", "Store or business name")} htmlFor="acc-name" className="min-w-[240px] flex-1">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} required disabled={!canManage} />
        </Field>
        {canManage && (
          <Button type="submit" variant="secondary" loading={saving} disabled={!name.trim() || name.trim() === account.name}>
            {t("Renommer", "Rename")}
          </Button>
        )}
        <p className="w-full text-xs text-slate-500 dark:text-slate-400">{t(`Compte créé le ${formatDate(account.created_at)}.`, `Account created ${formatDate(account.created_at)}.`)}</p>
      </form>
    </Card>
  );
}

// --- Team ----------------------------------------------------------------------------

function InviteModal({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited: (inv: Invitation, emailSent: boolean) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const res = await api.team.invite({ email: email.trim(), role });
      onInvited(res.invitation, res.email_sent);
      setEmail("");
      setRole("editor");
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Inviter un membre", "Invite a member")}
      description={t(
        "La personne reçoit un email pour créer son accès. Elle travaillera sur les mêmes campagnes et contacts que vous.",
        "They'll get an email to set up their access, and will work on the same campaigns and contacts as you.",
      )}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Annuler", "Cancel")}
          </Button>
          <Button type="submit" form="invite-form" icon={Mail} loading={sending}>
            {t("Envoyer l'invitation", "Send invitation")}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="space-y-5">
        <Field label={t("Adresse email", "Email address")} htmlFor="inv-email">
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("collegue@exemple.fr", "colleague@example.com")} autoFocus />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t("Rôle", "Role")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["editor", "admin"] as const).map((r) => {
              const def = ROLES[r];
              const active = role === r;
              return (
                <label
                  key={r}
                  className={cx(
                    "flex cursor-pointer flex-col gap-1.5 rounded-2xl p-4 ring-1 transition",
                    active ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/30" : "ring-slate-900/10 hover:ring-slate-900/30 dark:ring-white/10",
                  )}
                >
                  <input type="radio" name="role" value={r} checked={active} onChange={() => setRole(r)} className="sr-only" />
                  <span className="flex items-center gap-2 font-display text-sm font-bold text-slate-900 dark:text-white">
                    <def.icon className="size-4 text-brand-500" /> {def.label}
                  </span>
                  <span className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{def.description}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function TeamCard() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const team = useAsync(() => api.team.get(), []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [sent, setSent] = useState<{ inv: Invitation; emailSent: boolean } | null>(null);
  const [toRemove, setToRemove] = useState<User | null>(null);
  const [toCancel, setToCancel] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = team.data?.can_manage ?? false;
  const leaving = toRemove && toRemove.id === user?.id;

  async function changeRole(m: User, role: "admin" | "editor") {
    try {
      const updated = await api.team.setRole(m.id, role);
      team.setData((d) => ({ ...d!, members: d!.members.map((x) => (x.id === m.id ? updated : x)) }));
      toast.success(t(`${m.name} est maintenant ${ROLES[role].label.toLowerCase()}`, `${m.name} is now an ${ROLES[role].label.toLowerCase()}`));
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove() {
    if (!toRemove) return;
    setBusy(true);
    try {
      await api.team.remove(toRemove.id);
      if (leaving) {
        logout();
        navigate("/connexion", { replace: true });
        return;
      }
      team.setData((d) => ({ ...d!, members: d!.members.filter((x) => x.id !== toRemove.id) }));
      toast.success(t(`${toRemove.name} a été retiré(e) de l'équipe`, `${toRemove.name} was removed from the team`));
      setToRemove(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvite() {
    if (!toCancel) return;
    setBusy(true);
    try {
      await api.team.cancelInvite(toCancel.id);
      team.setData((d) => ({ ...d!, invitations: d!.invitations.filter((x) => x.id !== toCancel.id) }));
      toast.success(t("Invitation annulée", "Invitation canceled"));
      setToCancel(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function resend(inv: Invitation) {
    try {
      const res = await api.team.invite({ email: inv.email, role: inv.role });
      await team.reload();
      setSent({ inv: res.invitation, emailSent: res.email_sent });
    } catch (err) {
      toast.error(err);
    }
  }

  const members = team.data?.members ?? [];
  const invitations = team.data?.invitations ?? [];

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {t("Équipe", "Team")}
            {team.data && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-sans text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">{members.length}</span>}
          </span>
        }
        description={t("Les personnes qui gèrent les campagnes avec vous.", "The people running campaigns with you.")}
        action={
          canManage && (
            <Button size="sm" icon={UserPlus} onClick={() => setInviteOpen(true)}>
              {t("Inviter un membre", "Invite a member")}
            </Button>
          )
        }
      />

      {team.error ? (
        <div className="p-6">
          <ErrorState message={team.error} onRetry={team.reload} />
        </div>
      ) : team.loading && !team.data ? (
        <div className="space-y-3 p-6">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-900/[0.07] dark:divide-white/[0.07]">
            {members.map((m) => {
              const isMe = m.id === user?.id;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
                  <PersonAvatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900 dark:text-white">
                      {m.name}
                      {isMe && <span className="text-xs font-normal text-slate-400">{t("(vous)", "(you)")}</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {m.email} ·{" "}
                      {m.last_seen_at
                        ? t(`actif ${formatRelative(m.last_seen_at)}`, `active ${formatRelative(m.last_seen_at)}`)
                        : t(`membre depuis le ${formatDate(m.created_at)}`, `member since ${formatDate(m.created_at)}`)}
                    </p>
                  </div>
                  {canManage && m.role !== "owner" && !isMe ? (
                    <Select value={m.role} onChange={(e) => void changeRole(m, e.target.value as "admin" | "editor")} className="h-9 w-auto text-sm" aria-label={t(`Rôle de ${m.name}`, `${m.name}'s role`)}>
                      <option value="editor">{ROLES.editor.label}</option>
                      <option value="admin">{ROLES.admin.label}</option>
                    </Select>
                  ) : (
                    <RoleBadge role={m.role} />
                  )}
                  {m.role !== "owner" && (canManage || isMe) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={isMe ? LogOut : Trash2}
                      onClick={() => setToRemove(m)}
                      title={isMe ? t("Quitter l'équipe", "Leave team") : t("Retirer de l'équipe", "Remove from team")}
                      aria-label={isMe ? t("Quitter l'équipe", "Leave team") : t(`Retirer ${m.name}`, `Remove ${m.name}`)}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {invitations.length > 0 && (
            <div className="border-t border-slate-900/10 px-6 py-5 dark:border-white/10">
              <p className="eyebrow mb-3">{t("Invitations en attente", "Pending invitations")}</p>
              <ul className="space-y-2">
                {invitations.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 dark:bg-white/[0.03]">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400 dark:border-white/20">
                      <Mail className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{inv.email}</p>
                      <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <Clock className="size-3" />
                        {inv.expired ? t("Expirée", "Expired") : t(`Expire ${formatRelative(inv.expires_at)}`, `Expires ${formatRelative(inv.expires_at)}`)}
                        {inv.invited_by && t(` · invitée par ${inv.invited_by}`, ` · invited by ${inv.invited_by}`)}
                      </p>
                    </div>
                    {inv.expired ? <Badge tone="amber">{t("Expirée", "Expired")}</Badge> : <RoleBadge role={inv.role} />}
                    {canManage && (
                      <div className="flex items-center gap-1">
                        {inv.link && !inv.expired && <CopyButton text={inv.link} label={t("Copier le lien", "Copy link")} />}
                        <Button variant="ghost" size="sm" onClick={() => void resend(inv)}>
                          {t("Renvoyer", "Resend")}
                        </Button>
                        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToCancel(inv)} aria-label={t(`Annuler l'invitation de ${inv.email}`, `Cancel invitation for ${inv.email}`)}
                          title={t("Annuler l'invitation", "Cancel invitation")}
                         />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {members.length === 1 && invitations.length === 0 && canManage && (
            <div className="flex flex-col items-center gap-3 border-t border-slate-900/10 px-6 py-10 text-center dark:border-white/10">
              <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-900/30">
                <Users className="size-5" />
              </span>
              <div>
                <p className="font-display text-sm font-bold text-slate-900 uppercase dark:text-white">{t("Travaillez à plusieurs", "Work as a team")}</p>
                <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                  {t(
                    "Invitez un associé, un freelance ou votre agence pour préparer et envoyer les campagnes avec vous.",
                    "Invite a partner, a freelancer or your agency to prepare and send campaigns with you.",
                  )}
                </p>
              </div>
              <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setInviteOpen(true)}>
                {t("Inviter un membre", "Invite a member")}
              </Button>
            </div>
          )}
        </>
      )}

      <div className="border-t border-slate-900/10 px-6 py-5 dark:border-white/10">
        <p className="eyebrow mb-3">{t("Les rôles", "Roles")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(ROLES) as Role[]).map((r) => (
            <div key={r} className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <RoleBadge role={r} />
              <p className="mt-1.5">{ROLES[r].description}</p>
            </div>
          ))}
        </div>
      </div>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={(inv, emailSent) => {
          setInviteOpen(false);
          setSent({ inv, emailSent });
          void team.reload();
        }}
      />

      <Modal
        open={!!sent}
        onClose={() => setSent(null)}
        title={t("Invitation envoyée", "Invitation sent")}
        description={
          sent
            ? t(
                `${sent.inv.email} va recevoir un email pour rejoindre l'équipe en tant que ${ROLES[sent.inv.role].label.toLowerCase()}.`,
                `${sent.inv.email} will get an email to join the team as an ${ROLES[sent.inv.role].label.toLowerCase()}.`,
              )
            : undefined
        }
        footer={<Button onClick={() => setSent(null)}>{t("Terminé", "Done")}</Button>}
      >
        {sent?.inv.link && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {sent.emailSent
                ? t("Vous pouvez aussi lui partager ce lien directement :", "You can also share this link with them directly:")
                : t("L'email n'a pas pu partir. Partagez ce lien directement :", "The email couldn't be sent. Share this link directly:")}
            </p>
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-2 pl-3 dark:bg-white/5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900 dark:text-white">{sent.inv.link}</code>
              <CopyButton text={sent.inv.link} />
            </div>
            <p className="text-xs text-slate-500">{t("Valable 7 jours.", "Valid for 7 days.")}</p>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={remove}
        loading={busy}
        danger
        title={leaving ? t("Quitter l'équipe ?", "Leave the team?") : t(`Retirer ${toRemove?.name ?? ""} ?`, `Remove ${toRemove?.name ?? ""}?`)}
        description={
          leaving
            ? t("Vous perdrez immédiatement l'accès à ce compte.", "You'll lose access to this account immediately.")
            : t(
                "Cette personne perdra immédiatement l'accès. Les campagnes qu'elle a créées restent dans le compte.",
                "They'll lose access immediately. Campaigns they created stay in the account.",
              )
        }
        confirmLabel={leaving ? t("Quitter", "Leave") : t("Retirer", "Remove")}
      />
      <ConfirmModal
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={cancelInvite}
        loading={busy}
        danger
        title={t("Annuler l'invitation ?", "Cancel invitation?")}
        description={t(`Le lien envoyé à ${toCancel?.email ?? ""} ne fonctionnera plus.`, `The link sent to ${toCancel?.email ?? ""} will stop working.`)}
        confirmLabel={t("Annuler l'invitation", "Cancel invitation")}
      />
    </Card>
  );
}

// --- Page ------------------------------------------------------------------------------

export function ProfilePage() {
  const { user, account } = useAuth();

  return (
    <>
      <PageHeader
        title={t("Profil & équipe", "Profile & team")}
        description={t("Vos informations, votre mot de passe et les personnes qui travaillent avec vous.", "Your details, your password and the people you work with.")}
      />

      {user ? (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-[20px] bg-slate-900 p-6 text-white">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-500 font-display text-xl font-extrabold">{initials(user.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-tight font-extrabold tracking-[-0.02em] uppercase">{user.name}</p>
            <p className="truncate text-sm text-white/60">
              {user.email} · {account?.name}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 font-display text-xs font-semibold">
            {(() => {
              const R = ROLES[user.role];
              return (
                <>
                  <R.icon className="size-3.5" /> {R.label}
                </>
              );
            })()}
          </span>
        </div>
      ) : (
        <Skeleton className="mb-6 h-28 w-full rounded-[20px]" />
      )}

      <div className="space-y-6">
        <TeamCard />
        {user && <ProfileCard key={user.id + user.email} user={user} />}
        <PasswordCard />
        <AccountCard key={account?.name} />
        {user?.role === "owner" && <DeleteAccountCard accountName={account?.name ?? ""} />}
      </div>
    </>
  );
}

/** Owner only: permanent deletion, confirmed by typing the shop name and the password. */
function DeleteAccountCard({ accountName }: { accountName: string }) {
  const { logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = name.trim() === accountName.trim() && password.length > 0;

  async function remove(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await api.account.remove(password);
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }
      logout();
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  }

  return (
    <Card className="ring-red-200 dark:ring-red-900/50">
      <CardHeader
        title={t("Supprimer le compte", "Delete account")}
        description={t(
          "Supprime définitivement la boutique, ses contacts, campagnes, automatisations, notifications et l'équipe.",
          "Permanently deletes the store and its contacts, campaigns, automations, notifications and team.",
        )}
      />
      <div className="flex flex-col gap-3 p-5 pt-0 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("Cette action est irréversible. Pensez à exporter vos contacts avant.", "This can't be undone. Export your contacts first.")}</p>
        <Button variant="ghost" icon={Trash2} onClick={() => setOpen(true)} className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40">
          {t("Supprimer le compte", "Delete account")}
        </Button>
      </div>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title={t("Supprimer définitivement le compte ?", "Permanently delete this account?")}>
        <form onSubmit={(e) => void remove(e)} className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t(
              <>
                Toutes les données de <span className="font-semibold text-slate-900 dark:text-white">{accountName}</span> seront effacées et les membres de
                l'équipe perdront l'accès. Impossible de revenir en arrière.
              </>,
              <>
                All data for <span className="font-semibold text-slate-900 dark:text-white">{accountName}</span> will be erased and team members will lose
                access. This can't be undone.
              </>,
            )}
          </p>
          <Field label={t(`Tapez « ${accountName} » pour confirmer`, `Type “${accountName}” to confirm`)} htmlFor="del-name">
            <Input id="del-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={t("Votre mot de passe", "Your password")} htmlFor="del-pw">
            <Input id="del-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={!ready} loading={busy} icon={Trash2}>
              {t("Supprimer définitivement", "Delete permanently")}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

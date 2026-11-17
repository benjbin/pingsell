import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Clock, Crown, LogOut, Mail, PenLine, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { cx, formatDate, formatRelative } from "../lib/format";
import type { Invitation, Role, User } from "../lib/types";
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, PageHeader, Select, Skeleton } from "../components/ui/primitives";
import { ConfirmModal, Modal } from "../components/ui/Overlay";
import { useToast } from "../components/ui/Toast";
import { CopyButton } from "../components/CopyButton";

export const ROLES: Record<Role, { label: string; description: string; icon: typeof Crown; tone: "brand" | "blue" | "slate" }> = {
  owner: { label: "Propriétaire", description: "Accès complet, ne peut pas être retiré.", icon: Crown, tone: "brand" },
  admin: { label: "Administrateur", description: "Tout gérer : campagnes, contacts, intégrations, clés API et équipe.", icon: Shield, tone: "blue" },
  editor: { label: "Éditeur", description: "Créer et envoyer des campagnes, gérer contacts, segments et automatisations. Pas d'accès à l'équipe ni aux clés API.", icon: PenLine, tone: "slate" },
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
      toast.success("Profil mis à jour");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Informations personnelles" description="Votre nom apparaît auprès de l'équipe ; l'email sert à vous connecter." />
      <form onSubmit={save} className="grid gap-4 p-6 sm:grid-cols-2">
        <Field label="Nom complet" htmlFor="p-name">
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </Field>
        <Field label="Email de connexion" htmlFor="p-email">
          <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={saving} disabled={!dirty}>
            Enregistrer
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
      toast.success("Mot de passe modifié", "Vos autres sessions ont été déconnectées.");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Mot de passe" description="Changer de mot de passe déconnecte vos autres appareils." />
      <form onSubmit={save} className="grid gap-4 p-6 sm:grid-cols-3">
        <Field label="Mot de passe actuel" htmlFor="pw-current">
          <Input id="pw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
        </Field>
        <Field label="Nouveau mot de passe" htmlFor="pw-next" hint="8 caractères minimum.">
          <Input id="pw-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
        </Field>
        <Field label="Confirmation" htmlFor="pw-confirm" error={mismatch ? "Les mots de passe ne correspondent pas" : undefined}>
          <Input id="pw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="secondary" loading={saving} disabled={!current || next.length < 8 || mismatch}>
            Changer le mot de passe
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
      toast.success("Nom de la boutique mis à jour");
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Boutique" description="Le nom utilisé par défaut comme expéditeur et dans vos emails." />
      <form onSubmit={save} className="flex flex-wrap items-end gap-3 p-6">
        <Field label="Nom de la boutique ou de l'entreprise" htmlFor="acc-name" className="min-w-[240px] flex-1">
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} required disabled={!canManage} />
        </Field>
        {canManage && (
          <Button type="submit" variant="secondary" loading={saving} disabled={!name.trim() || name.trim() === account.name}>
            Renommer
          </Button>
        )}
        <p className="w-full text-xs text-slate-500 dark:text-slate-400">Compte créé le {formatDate(account.created_at)}.</p>
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
      title="Inviter un membre"
      description="La personne reçoit un email pour créer son accès. Elle travaillera sur les mêmes campagnes et contacts que vous."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="invite-form" icon={Mail} loading={sending}>
            Envoyer l'invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="space-y-5">
        <Field label="Adresse email" htmlFor="inv-email">
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="collegue@exemple.fr" autoFocus />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Rôle</legend>
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
      toast.success(`${m.name} est maintenant ${ROLES[role].label.toLowerCase()}`);
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
      toast.success(`${toRemove.name} a été retiré(e) de l'équipe`);
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
      toast.success("Invitation annulée");
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
            Équipe
            {team.data && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-sans text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">{members.length}</span>}
          </span>
        }
        description="Les personnes qui gèrent les campagnes avec vous."
        action={
          canManage && (
            <Button size="sm" icon={UserPlus} onClick={() => setInviteOpen(true)}>
              Inviter un membre
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
                      {isMe && <span className="text-xs font-normal text-slate-400">(vous)</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {m.email} · {m.last_seen_at ? `actif ${formatRelative(m.last_seen_at)}` : `membre depuis le ${formatDate(m.created_at)}`}
                    </p>
                  </div>
                  {canManage && m.role !== "owner" && !isMe ? (
                    <Select value={m.role} onChange={(e) => void changeRole(m, e.target.value as "admin" | "editor")} className="h-9 w-auto text-sm" aria-label={`Rôle de ${m.name}`}>
                      <option value="editor">Éditeur</option>
                      <option value="admin">Administrateur</option>
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
                      title={isMe ? "Quitter l'équipe" : "Retirer de l'équipe"}
                      aria-label={isMe ? "Quitter l'équipe" : `Retirer ${m.name}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {invitations.length > 0 && (
            <div className="border-t border-slate-900/10 px-6 py-5 dark:border-white/10">
              <p className="eyebrow mb-3">Invitations en attente</p>
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
                        {inv.expired ? "Expirée" : `Expire ${formatRelative(inv.expires_at)}`}
                        {inv.invited_by && ` · invitée par ${inv.invited_by}`}
                      </p>
                    </div>
                    {inv.expired ? <Badge tone="amber">Expirée</Badge> : <RoleBadge role={inv.role} />}
                    {canManage && (
                      <div className="flex items-center gap-1">
                        {inv.link && !inv.expired && <CopyButton text={inv.link} label="Copier le lien" />}
                        <Button variant="ghost" size="sm" onClick={() => void resend(inv)}>
                          Renvoyer
                        </Button>
                        <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setToCancel(inv)} aria-label={`Annuler l'invitation de ${inv.email}`} title="Annuler l'invitation" />
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
                <p className="font-display text-sm font-bold text-slate-900 uppercase dark:text-white">Travaillez à plusieurs</p>
                <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">Invitez un associé, un freelance ou votre agence pour préparer et envoyer les campagnes avec vous.</p>
              </div>
              <Button size="sm" variant="secondary" icon={UserPlus} onClick={() => setInviteOpen(true)}>
                Inviter un membre
              </Button>
            </div>
          )}
        </>
      )}

      <div className="border-t border-slate-900/10 px-6 py-5 dark:border-white/10">
        <p className="eyebrow mb-3">Les rôles</p>
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
        title="Invitation envoyée"
        description={sent ? `${sent.inv.email} va recevoir un email pour rejoindre l'équipe en tant que ${ROLES[sent.inv.role].label.toLowerCase()}.` : undefined}
        footer={<Button onClick={() => setSent(null)}>Terminé</Button>}
      >
        {sent?.inv.link && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {sent.emailSent ? "Vous pouvez aussi lui partager ce lien directement :" : "L'email n'a pas pu partir. Partagez ce lien directement :"}
            </p>
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-2 pl-3 dark:bg-white/5">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900 dark:text-white">{sent.inv.link}</code>
              <CopyButton text={sent.inv.link} />
            </div>
            <p className="text-xs text-slate-500">Valable 7 jours.</p>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={remove}
        loading={busy}
        danger
        title={leaving ? "Quitter l'équipe ?" : `Retirer ${toRemove?.name ?? ""} ?`}
        description={leaving ? "Vous perdrez immédiatement l'accès à ce compte." : "Cette personne perdra immédiatement l'accès. Les campagnes qu'elle a créées restent dans le compte."}
        confirmLabel={leaving ? "Quitter" : "Retirer"}
      />
      <ConfirmModal
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={cancelInvite}
        loading={busy}
        danger
        title="Annuler l'invitation ?"
        description={`Le lien envoyé à ${toCancel?.email ?? ""} ne fonctionnera plus.`}
        confirmLabel="Annuler l'invitation"
      />
    </Card>
  );
}

// --- Page ------------------------------------------------------------------------------

export function ProfilePage() {
  const { user, account } = useAuth();

  return (
    <>
      <PageHeader title="Profil & équipe" description="Vos informations, votre mot de passe et les personnes qui travaillent avec vous." />

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
      </div>
    </>
  );
}

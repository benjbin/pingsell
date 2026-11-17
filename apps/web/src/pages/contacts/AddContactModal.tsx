import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Button, Field, Input } from "../../components/ui/primitives";
import { Modal } from "../../components/ui/Overlay";
import { TagInput } from "../../components/ui/TagInput";
import { useToast } from "../../components/ui/Toast";
import { t } from "../../lib/i18n";

export function AddContactModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const tagList = useAsync(() => (open ? api.tags() : Promise.resolve([])), [open]);

  function reset() {
    setEmail("");
    setFirstName("");
    setLastName("");
    setPhone("");
    setTags([]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.contacts.create({
        email: email.trim(),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        tags,
      });
      toast.success(t("Contact enregistré", "Contact saved"), email.trim());
      reset();
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Ajouter un contact", "Add a contact")}
      description={t("Si l'email existe déjà, le contact sera mis à jour.", "If the email already exists, the contact will be updated.")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("Annuler", "Cancel")}
          </Button>
          <Button type="submit" form="add-contact-form" loading={saving}>
            {t("Enregistrer", "Save")}
          </Button>
        </>
      }
    >
      <form id="add-contact-form" onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("Email *", "Email *")} htmlFor="c-email" className="sm:col-span-2">
          <Input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("client@exemple.fr", "customer@example.com")} />
        </Field>
        <Field label={t("Prénom", "First name")} htmlFor="c-first">
          <Input id="c-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label={t("Nom", "Last name")} htmlFor="c-last">
          <Input id="c-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label={t("Téléphone", "Phone")} htmlFor="c-phone" className="sm:col-span-2">
          <Input id="c-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("+33 6 12 34 56 78", "+1 555 123 4567")} />
        </Field>
        <Field label={t("Tags", "Tags")} htmlFor="c-tags" className="sm:col-span-2" hint={t("Entrée ou virgule pour valider un tag.", "Press Enter or comma to add a tag.")}>
          <TagInput id="c-tags" value={tags} onChange={setTags} suggestions={(tagList.data ?? []).map((tg) => tg.tag)} />
        </Field>
      </form>
    </Modal>
  );
}

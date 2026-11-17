import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Button, Field, Input } from "../../components/ui/primitives";
import { Modal } from "../../components/ui/Overlay";
import { TagInput } from "../../components/ui/TagInput";
import { useToast } from "../../components/ui/Toast";

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
      toast.success("Contact enregistré", email.trim());
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
      title="Ajouter un contact"
      description="Si l'email existe déjà, le contact sera mis à jour."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" form="add-contact-form" loading={saving}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="add-contact-form" onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email *" htmlFor="c-email" className="sm:col-span-2">
          <Input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.fr" />
        </Field>
        <Field label="Prénom" htmlFor="c-first">
          <Input id="c-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Nom" htmlFor="c-last">
          <Input id="c-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label="Téléphone" htmlFor="c-phone" className="sm:col-span-2">
          <Input id="c-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33 6 12 34 56 78" />
        </Field>
        <Field label="Tags" htmlFor="c-tags" className="sm:col-span-2" hint="Entrée ou virgule pour valider un tag.">
          <TagInput id="c-tags" value={tags} onChange={setTags} suggestions={(tagList.data ?? []).map((t) => t.tag)} />
        </Field>
      </form>
    </Modal>
  );
}

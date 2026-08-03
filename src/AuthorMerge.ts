import { hasDiacritics, isAbbreviationOf, normName } from "./nameUtils";

// ---------------------------------------------------------------------------
// Author merge planning
//
// Pure field-level resolution between the Person note already in the vault and
// the author data coming from the API.  Deliberately free of Obsidian imports
// so the rules can be read (and reasoned about) in isolation.
// ---------------------------------------------------------------------------

export type FieldSource = "vault" | "incoming";

export type PersonFieldKey = "first_name" | "last_name" | "ORCiD";

export interface MergeField {
  key: PersonFieldKey;
  label: string;
  vault: string;
  incoming: string;
  /** Which side wins. The modal writes user overrides back into this. */
  chosen: FieldSource;
  /** Both sides say the same thing — nothing to decide, hide from the UI. */
  identical: boolean;
  /** Both sides carry real, differing values and neither dominates. */
  conflicting: boolean;
}

export interface PersonFields {
  given: string;
  family: string;
  orcid: string;
}

/** Strips the URL prefix Crossref sometimes leaves on an ORCID. */
export function normOrcid(orcid: string): string {
  return orcid.replace(/^https?:\/\/orcid\.org\//i, "").trim();
}

/** The value a resolved field will be written with. */
export function valueOf(field: MergeField): string {
  return field.chosen === "vault" ? field.vault : field.incoming;
}

/** Convenience: the resolved record a set of fields describes. */
export function mergedFields(fields: MergeField[]): PersonFields {
  const pick = (key: PersonFieldKey): string => {
    const field = fields.find((f) => f.key === key);
    return field ? valueOf(field) : "";
  };
  return {
    given: pick("first_name"),
    family: pick("last_name"),
    orcid: pick("ORCiD"),
  };
}

/**
 * Resolves one name field.  Ambiguity always defaults to the vault, so a merge
 * can never silently degrade a name the user curated by hand.
 */
function resolveName(
  key: PersonFieldKey,
  label: string,
  vault: string,
  incoming: string
): MergeField {
  const base = { key, label, vault, incoming };

  if (!incoming.trim()) {
    return { ...base, chosen: "vault", identical: !vault.trim(), conflicting: false };
  }
  if (!vault.trim()) {
    return { ...base, chosen: "incoming", identical: false, conflicting: false };
  }
  if (vault === incoming) {
    return { ...base, chosen: "vault", identical: true, conflicting: false };
  }

  // Same name, different spelling — keep the accented form, it carries more.
  if (normName(vault) === normName(incoming)) {
    const preferIncoming = hasDiacritics(incoming) && !hasDiacritics(vault);
    return {
      ...base,
      chosen: preferIncoming ? "incoming" : "vault",
      identical: false,
      conflicting: false,
    };
  }

  // One side is an abbreviation of the other — the expanded form wins.
  if (isAbbreviationOf(vault, incoming)) {
    return { ...base, chosen: "incoming", identical: false, conflicting: false };
  }
  if (isAbbreviationOf(incoming, vault)) {
    return { ...base, chosen: "vault", identical: false, conflicting: false };
  }

  // Genuinely different ("Al" vs "Alberto") — flag it, keep the vault value.
  return { ...base, chosen: "vault", identical: false, conflicting: true };
}

function resolveOrcid(vault: string, incoming: string): MergeField {
  const base = {
    key: "ORCiD" as const,
    label: "ORCID",
    vault,
    incoming: normOrcid(incoming),
  };
  const v = normOrcid(vault);

  if (!base.incoming) {
    return { ...base, chosen: "vault", identical: !v, conflicting: false };
  }
  if (!v) {
    return { ...base, chosen: "incoming", identical: false, conflicting: false };
  }
  if (v === base.incoming) {
    return { ...base, chosen: "vault", identical: true, conflicting: false };
  }
  // Two different ORCIDs on what the user is about to call one person.
  return { ...base, chosen: "vault", identical: false, conflicting: true };
}

/**
 * Builds the per-field merge plan between an existing Person note and the
 * incoming author.  The result is what the disambiguation modal previews and
 * what NoteCreator.mergePerson applies.
 */
export function planAuthorMerge(
  vault: PersonFields,
  incoming: { given: string; family: string; orcid?: string }
): MergeField[] {
  return [
    resolveName("first_name", "First name", vault.given, incoming.given),
    resolveName("last_name", "Last name", vault.family, incoming.family),
    resolveOrcid(vault.orcid, incoming.orcid ?? ""),
  ];
}

/**
 * The subset of a plan that only fills gaps: fields the vault note leaves
 * empty.  Used by the "Same — reuse vault entry" path, which enriches the
 * existing note without ever replacing anything.
 */
export function additiveFields(fields: MergeField[]): MergeField[] {
  return fields.filter((f) => !f.identical && !f.vault.trim() && valueOf(f).trim());
}

/** True when committing this plan replaces a non-empty vault value. */
export function isDestructive(fields: MergeField[]): boolean {
  return fields.some(
    (f) => !f.identical && f.chosen === "incoming" && Boolean(f.vault.trim())
  );
}

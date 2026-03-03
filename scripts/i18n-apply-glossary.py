#!/usr/bin/env python3
"""
Apply a small EN→FR glossary to a locale file.

This is intentionally conservative:
- Only replaces values when the locale value is IDENTICAL to the source value
  (i.e. likely still untranslated).
- Only replaces exact full-string matches from the glossary.

Usage:
  python3 scripts/i18n-apply-glossary.py --source apps/web/messages/en.json --locale apps/web/messages/fr.json --dry-run
  python3 scripts/i18n-apply-glossary.py --source apps/web/messages/en.json --locale apps/web/messages/fr.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Tuple


GLOSSARY_EN_TO_FR: Dict[str, str] = {
    "Accept": "Accepter",
    "Reject": "Refuser",
    "Cancel": "Annuler",
    "Cancel Invitation": "Annuler l’invitation",
    "Close": "Fermer",
    "Confirm": "Confirmer",
    "Copy": "Copier",
    "Copied to clipboard": "Copié dans le presse-papiers",
    "Create": "Créer",
    "Created": "Créé",
    "Delete": "Supprimer",
    "Description": "Description",
    "Done": "Terminé",
    "Edit": "Modifier",
    "Enable": "Activer",
    "Enabled": "Activé",
    "Disable": "Désactiver",
    "Disabled": "Désactivé",
    "Expand": "Développer",
    "Failed": "Échec",
    "Files": "Fichiers",
    "Hiring": "Engagement",
    "Hiring Failed": "Échec de l’engagement",
    "Agent Connection Failed": "Échec de connexion à l’agent",
    "Node Connection Failed": "Échec de connexion au nœud",
    "Input Required": "Saisie requise",
    "Invite Member": "Inviter un membre",
    "Job not found": "Job introuvable",
    "Jobs": "Jobs",
    "Links": "Liens",
    "Save": "Enregistrer",
    "Back": "Retour",
    "Next": "Suivant",
    "Skip": "Passer",
    "Apply": "Appliquer",
    "Reset": "Réinitialiser",
    "Remove attachment": "Supprimer la pièce jointe",
    "Search": "Rechercher",
    "Loading": "Chargement",
    "Try Again": "Réessayer",
    "Continue": "Continuer",
    "Login": "Se connecter",
    "Logout": "Se déconnecter",
    "Register": "S’inscrire",
    "Email": "E-mail",
    "Name": "Nom",
    "Password": "Mot de passe",
    "Current password": "Mot de passe actuel",
    "Confirm password": "Confirmer le mot de passe",
    "New": "Nouveau",
    "New Job": "Nouveau job",
    "Customer Support": "Support client",
    "Organization": "Organisation",
    "Organizations": "Organisations",
    "Pending": "En attente",
    "Properties": "Propriétés",
    "Request Refund": "Demander un remboursement",
    "Refund Requested": "Remboursement demandé",
    "Refunded": "Remboursé",
    "Dispute Pending": "Litige en attente",
    "Dispute Resolved": "Litige résolu",
    "Scheduled Agents": "Agents planifiés",
    "Show less": "Réduire",
    "Sign In": "Se connecter",
    "Please sign in to continue": "Veuillez vous connecter pour continuer",
    "Something Went Wrong": "Une erreur est survenue",
    "Started": "Démarré",
    "Status": "Statut",
    "Submit": "Envoyer",
    "Task": "Tâche",
    "Updated": "Mis à jour",
    "Unknown": "Inconnu",
    "You are not the owner of this job.": "Vous n’êtes pas le propriétaire de ce job.",
    "Credits": "Crédits",
    "Add credits": "Ajouter des crédits",
    "Completed": "Terminé",
    "Working": "En cours",
    "Task Manager": "Gestionnaire de tâches",
    "Coworker": "Collègue",
    "Current plan": "Forfait actuel",
    "Billing Portal": "Portail de facturation",
    "Open billing portal": "Ouvrir le portail de facturation",
    "Opening...": "Ouverture...",
    "Free": "Gratuit",
    "No jobs yet.": "Aucun job pour le moment.",
    "Loading...": "Chargement...",
    "Something went wrong": "Une erreur est survenue",
    "Something went wrong. Please try again.": "Une erreur est survenue. Veuillez réessayer.",
    "OK": "OK",
    "Leave": "Quitter",
    "Details": "Détails",
    "System": "Système",
    "Draft": "Brouillon",
    "Ready": "Prêt",
    "Upload File": "Téléverser un fichier",
    "Failed to upload file": "Échec du téléversement du fichier",
    "Untitled job": "Job sans titre",
    "Task name": "Nom de la tâche",
    "Enter a short title": "Saisissez un titre court",
    "Choose a Coworker LLM that will manage this task for you": "Choisissez un LLM de collègue qui gérera cette tâche pour vous",
    "API Keys": "Clés API",
    "New password": "Nouveau mot de passe",
    "Confirm new password": "Confirmer le nouveau mot de passe",
    "Set password": "Définir un mot de passe",
    "Delete account": "Supprimer le compte",
    "Delete API Key": "Supprimer la clé API",
    "Create OAuth Client": "Créer un client OAuth",
    "Client ID": "ID client",
    "Client Secret": "Secret client",
    "Invoice Email": "E-mail de facturation",
    "Remove": "Retirer",
    "Change Role": "Changer le rôle",
    "Change to Owner": "Passer en propriétaire",
    "Change to Admin": "Passer en administrateur",
    "Change to Member": "Passer en membre",
    "Remove Member": "Retirer le membre",
    "Role changed successfully": "Rôle modifié avec succès",
    "Member removed successfully": "Membre retiré avec succès",
    "Failed to change role": "Échec de la modification du rôle",
    "Failed to remove member": "Échec du retrait du membre",
    "Resend Invitation": "Renvoyer l’invitation",
    "Invitation resent successfully": "Invitation renvoyée avec succès",
    "Failed to resend invitation": "Échec du renvoi de l’invitation",
    "Invitation canceled successfully": "Invitation annulée avec succès",
    "Failed to cancel invitation": "Échec de l’annulation de l’invitation",
    "Gallery": "Galerie",
    "Subscriptions": "Abonnements",
    "Billing": "Facturation",
    "Account": "Compte",
    "API Documentation": "Documentation API",
    "to confirm deletion:": "pour confirmer la suppression :",
    "Organization name must be at least 2 characters.": "Le nom de l’organisation doit contenir au moins 2 caractères.",
    "Organization name must be at most 50 characters.": "Le nom de l’organisation doit contenir au maximum 50 caractères.",
    "Organization name must be a valid string.": "Le nom de l’organisation doit être une chaîne valide.",
    "Organization name is required": "Le nom de l’organisation est requis",
    "Connections": "Connexions",
    "Demo": "Démo",
    "Result Missing": "Résultat manquant",
    "Initiated": "Initié",
    "Awaiting Payment": "En attente de paiement",
    "Shared": "Partagé",
    "Shared by": "Partagé par",
    "No activities yet.": "Aucune activité pour le moment.",
    "Name must be a valid string": "Le nom doit être une chaîne valide",
    "Name must be at least 2 characters": "Le nom doit contenir au moins 2 caractères",
    "Name must be at most 80 characters": "Le nom doit contenir au maximum 80 caractères",
    "Please input Job Name": "Veuillez saisir un nom de job",
    "No name": "Sans nom",
    "Shared publicly": "Partagé publiquement",
    "Shared with organization": "Partagé avec l’organisation",
    "Private": "Privé",
    "Job name updated successfully": "Nom du job mis à jour avec succès",
    "Failed to update job name": "Échec de la mise à jour du nom du job",
    "You must be logged in to update job name.": "Vous devez être connecté pour mettre à jour le nom du job.",
    "Open task": "Tâche ouverte",
    "Job ID": "ID du job",
    "Txn ID": "ID de transaction",
    "Input hash": "Hash d’entrée",
    "Result hash": "Hash de résultat",
    "On-Chain": "On-chain",
    "Missing": "Manquant",
    "Finished": "Terminé",
    "What you sent to the agent for this job": "Ce que vous avez envoyé à l’agent pour ce job",
    "Share": "Partager",
    "Share job": "Partager le job",
    "Public access": "Accès public",
    "Anyone with the link can view": "Toute personne disposant du lien peut voir",
    "Organization access": "Accès organisation",
    "Anyone inside {organizationName} can view": "Toute personne au sein de {organizationName} peut voir",
    "Private access": "Accès privé",
    "Only you can view": "Vous seul pouvez voir",
    "Allow this result to be indexed by Search Engines": "Autoriser ce résultat à être indexé par les moteurs de recherche",
    "Get the link": "Obtenir le lien",
    "Copy link": "Copier le lien",
    "Successfully update share": "Partage mis à jour avec succès",
    "Successfully copy link": "Lien copié avec succès",
    "Failed to update share": "Échec de la mise à jour du partage",
    "Failed to copy link": "Échec de la copie du lien",
    "You must be logged in.": "Vous devez être connecté.",
    "Job Share not found": "Partage de job introuvable",
    "{direction} hash is verified. Click here to learn more": "Le hash {direction} est vérifié. Cliquez ici pour en savoir plus",
    "{direction} hash is unverified. Click here to learn more": "Le hash {direction} n’est pas vérifié. Cliquez ici pour en savoir plus",
    "{direction} hash verification is pending. Click here to learn more": "La vérification du hash {direction} est en attente. Cliquez ici pour en savoir plus",
    "{direction} hash verification is not available for free jobs. Click here to learn more": "La vérification du hash {direction} n’est pas disponible pour les jobs gratuits. Cliquez ici pour en savoir plus",
    "Input": "Entrée",
    "Failed to parse input": "Échec de l’analyse de l’entrée",
    "No input": "Aucune entrée",
    "Yes": "Oui",
    "No": "Non",
    "Result": "Résultat",
    "Are you sure you want to change the role of {member} to Owner?": "Êtes-vous sûr de vouloir changer le rôle de {member} en propriétaire ?",
    "Are you sure you want to change the role of {member} to Admin?": "Êtes-vous sûr de vouloir changer le rôle de {member} en administrateur ?",
    "Are you sure you want to change the role of {member} to Member?": "Êtes-vous sûr de vouloir changer le rôle de {member} en membre ?",
    "Are you sure you want to remove {member} from the organization?": "Êtes-vous sûr de vouloir retirer {member} de l’organisation ?",
    "Are you sure you want to cancel the invitation of {email}?": "Êtes-vous sûr de vouloir annuler l’invitation de {email} ?",
    "Terms and Conditions": "Conditions générales",
    "Privacy Policy": "Politique de confidentialité",
    "Terms of Service": "Conditions d’utilisation",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def apply_glossary(source: Any, locale: Any) -> Tuple[Any, int]:
    if isinstance(source, dict) and isinstance(locale, dict):
        updated = {}
        changed = 0
        for k, s_val in source.items():
            l_val = locale.get(k)
            if k in locale:
                new_val, delta = apply_glossary(s_val, l_val)
                updated[k] = new_val
                changed += delta
            else:
                # Preserve source value when locale key is missing.
                updated[k] = s_val
        # Keep any extra locale keys (if present)
        for k in locale.keys():
            if k not in updated:
                updated[k] = locale[k]
        return updated, changed

    if isinstance(source, str) and isinstance(locale, str) and locale == source:
        replacement = GLOSSARY_EN_TO_FR.get(source)
        if replacement is not None and replacement != source:
            return replacement, 1

    return locale, 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--locale", required=True, type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    source_obj = read_json(args.source)
    locale_obj = read_json(args.locale)

    updated, changed = apply_glossary(source_obj, locale_obj)
    print(f"glossary_entries: {len(GLOSSARY_EN_TO_FR)}")
    print(f"changes: {changed}")

    if args.dry_run:
        return

    write_json(args.locale, updated)


if __name__ == "__main__":
    main()


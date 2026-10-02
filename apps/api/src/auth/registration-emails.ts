import { EMAIL_VERIFICATION_TTL_HOURS } from '@creno/shared';
import { type RenderedEmail, renderParts } from '../notifications/templates.js';

/**
 * Lien pour terminer l'inscription : le compte n'existe pas encore, il sera créé depuis ce lien.
 * Aucun texte saisi par l'auteur de la demande n'y figure (il n'a donné qu'une adresse) : personne
 * ne peut faire envoyer par Creno le message de son choix.
 */
export function registrationLinkEmail(completeUrl: string): RenderedEmail {
  return renderParts(null, {
    subject: 'Terminez votre inscription sur Creno',
    title: 'Terminez votre inscription',
    paragraphs: [
      `Pour créer votre compte Creno, ouvrez le lien ci-dessous : vous y choisirez votre nom et votre mot de passe. Il est valable ${EMAIL_VERIFICATION_TTL_HOURS} heures.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera créé.",
    ],
    action: { label: 'Terminer mon inscription', url: completeUrl },
  });
}

/**
 * Inscription demandée avec une adresse qui a déjà un compte. Le formulaire a répondu comme pour
 * une adresse nouvelle : seul le titulaire de la boîte mail apprend que le compte existe.
 */
export function accountExistsEmail(recipientName: string, loginUrl: string): RenderedEmail {
  return renderParts(recipientName, {
    subject: 'Vous avez déjà un compte Creno',
    title: 'Vous avez déjà un compte',
    paragraphs: [
      "Une inscription vient d'être demandée avec cette adresse, qui a déjà un compte Creno. Rien n'a été modifié : votre mot de passe reste le même.",
      "Si ce n'était pas vous, ignorez ce message.",
    ],
    action: { label: 'Se connecter', url: loginUrl },
  });
}

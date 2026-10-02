import { EMAIL_VERIFICATION_TTL_HOURS } from '@creno/shared';
import { type RenderedEmail, renderParts } from '../notifications/templates.js';

/**
 * Lien de confirmation : le compte n'existe pas encore, il sera créé au clic. Aucun texte saisi
 * dans le formulaire (le nom) n'y figure : n'importe qui peut demander une inscription pour
 * l'adresse d'un autre, et ferait ainsi envoyer par Creno le message de son choix.
 */
export function verificationEmail(verifyUrl: string): RenderedEmail {
  return renderParts(null, {
    subject: 'Confirmez votre adresse email',
    title: 'Confirmez votre adresse email',
    paragraphs: [
      `Pour créer votre compte Creno, confirmez cette adresse avec le lien ci-dessous. Il est valable ${EMAIL_VERIFICATION_TTL_HOURS} heures.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : aucun compte ne sera créé.",
    ],
    action: { label: 'Confirmer mon adresse', url: verifyUrl },
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

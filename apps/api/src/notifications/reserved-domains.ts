// Domaines réservés aux exemples et aux tests (RFC 2606, RFC 6761) : aucune boîte n'y existe.
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];
const RESERVED_TLDS = ['example', 'test', 'invalid', 'localhost'];

/**
 * Adresse sur un domaine qui ne reçoit pas d'email (comptes de démo en `@example.com`). Envoyer
 * quand même ferait rebondir le message et abîmerait la réputation du domaine d'envoi.
 */
export function isReservedEmailDomain(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return (
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`)) ||
    RESERVED_TLDS.includes(tld)
  );
}

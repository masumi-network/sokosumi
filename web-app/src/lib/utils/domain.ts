import publicDomains from "./public-email-domains.json" assert { type: "json" };

const domainRegex =
  /^(?!:\/\/)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export function isValidDomain(domain: string): boolean {
  return domainRegex.test(domain);
}

export function isPublicDomain(domain: string): boolean {
  const lowercaseDomain = domain.toLowerCase();
  return publicDomains.includes(lowercaseDomain);
}

export function removePublicDomains(domains: string[]): string[] {
  return domains.filter((domain) => !isPublicDomain(domain));
}

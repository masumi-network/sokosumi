const CONSENT_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "GF", "GP", "MQ", "RE", "YT", "MF", "AX",
  "IS", "LI", "NO", "GB", "CH", "JE", "GG", "IM",
]);

module.exports = (req, res) => {
  const country = String(req.headers["x-vercel-ip-country"] || "").toUpperCase();
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "x-vercel-ip-country");
  res.status(200).json({ consentRequired: !country || CONSENT_COUNTRIES.has(country) });
};

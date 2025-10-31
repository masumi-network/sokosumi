export interface UTMParams {
  utm_source: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface UTMData extends UTMParams {
  referrer?: string;
  landingPage?: string;
  capturedAt: string; // ISO Date string
}

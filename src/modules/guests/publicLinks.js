// Links guests open without signing in: the booking page and the feedback form.
import { IN_CLAUDE } from '../../platform';

/** Base address of this site, e.g. https://staybill.example.com/ (hash-routed inside claude.ai). */
export function siteBase() {
  const { origin, pathname } = window.location;
  return IN_CLAUDE ? `${origin}${pathname}#` : origin;
}
export const bookingUrl = (hotelId) => `${siteBase()}/book/${hotelId}`;
export const feedbackUrl = (hotelId, bill) => `${siteBase()}/feedback/${hotelId}/${bill.id}/${bill.feedbackToken || ''}`;
export const signupUrl = () => `${siteBase()}/signup`;

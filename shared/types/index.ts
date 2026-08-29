/**
 * Single entry point for all shared types.
 *
 * Import from `@shared/types` instead of the individual modules so callers don't
 * need to know how the types are split up (domain models vs. API payloads).
 */
export * from './domain'
export * from './api'

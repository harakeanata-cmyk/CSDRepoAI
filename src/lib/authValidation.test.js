import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword, normalizeEmail, hasStoredEmail } from './authValidation.js';

test('rejects weak passwords', () => {
  assert.equal(validatePassword('123').ok, false);
  assert.equal(validatePassword('password').ok, false);
  assert.equal(validatePassword('StrongPass1').ok, false);
  assert.equal(validatePassword('StrongPass1!').ok, true);
});

test('normalizes email addresses for duplicate checks', () => {
  assert.equal(normalizeEmail('User@Example.com'), 'user@example.com');
});

test('detects existing emails in a stored list', () => {
  const stored = [{ email: 'student@example.com' }];
  assert.equal(hasStoredEmail(stored, 'STUDENT@example.com'), true);
  assert.equal(hasStoredEmail(stored, 'other@example.com'), false);
});

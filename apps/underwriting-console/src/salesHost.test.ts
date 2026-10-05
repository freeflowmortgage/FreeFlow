import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_ORIGIN,
  appWorkspaceHref,
  isPublicIncomeDemoHash,
  isSalesLandingHost,
  isSoftwareEntryHost,
} from './salesHost';

test('sales and software hosts stay distinct', () => {
  assert.equal(isSalesLandingHost('dev.freeflowmortgage.com'), true);
  assert.equal(isSalesLandingHost('DEV.freeflowmortgage.com'), true);
  assert.equal(isSoftwareEntryHost('dev.freeflowmortgage.com'), false);
  assert.equal(isSoftwareEntryHost('app.dev.freeflowmortgage.com'), true);
  assert.equal(isSalesLandingHost('app.dev.freeflowmortgage.com'), false);
  assert.equal(isSalesLandingHost('127.0.0.1'), false);
  assert.equal(isSoftwareEntryHost('localhost'), false);
});

test('public income demo is the hash route and not a workspace path', () => {
  assert.equal(isPublicIncomeDemoHash('#demo-income'), true);
  assert.equal(isPublicIncomeDemoHash('demo-income'), true);
  assert.equal(isPublicIncomeDemoHash('#demo-1003'), false);
  assert.equal(isPublicIncomeDemoHash(''), false);
  assert.equal(appWorkspaceHref('split').includes('/workspace'), true);
  assert.equal(appWorkspaceHref('intake'), `${APP_ORIGIN}/workspace?product=intake`);
  assert.equal(appWorkspaceHref('split').startsWith(`${APP_ORIGIN}/`), true);
});

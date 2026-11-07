import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConnectionMonitor,
  FAILURE_THRESHOLD,
  HEARTBEAT_STALE_MS,
  isHeartbeatStale,
} from './connectionMonitor.ts';

test('one timeout followed by success stays online', () => {
  const monitor = new ConnectionMonitor();
  assert.equal(monitor.beginProbe(), true);
  assert.equal(monitor.completeProbe(false).offline, false);
  assert.equal(monitor.beginProbe(), true);
  const result = monitor.completeProbe(true);
  assert.equal(result.online, true);
  assert.equal(result.changed, true);
  assert.equal(monitor.failureCount, 0);
});

test('two consecutive timeouts enter offline', () => {
  const monitor = new ConnectionMonitor();
  for (let i = 0; i < FAILURE_THRESHOLD; i += 1) {
    assert.equal(monitor.beginProbe(), true);
    monitor.completeProbe(false);
  }
  assert.equal(monitor.isOnline, false);
});

test('success after offline restores online and resets failures', () => {
  const monitor = new ConnectionMonitor();
  monitor.completeProbe(false);
  monitor.completeProbe(false);
  assert.equal(monitor.isOnline, false);
  assert.equal(monitor.beginProbe(), true);
  const result = monitor.completeProbe(true);
  assert.equal(result.online, true);
  assert.equal(result.offline, false);
  assert.equal(monitor.failureCount, 0);
});

test('a probe cannot start while another is in flight', () => {
  const monitor = new ConnectionMonitor();
  assert.equal(monitor.beginProbe(), true);
  assert.equal(monitor.beginProbe(), false);
  monitor.completeProbe(true);
  assert.equal(monitor.beginProbe(), true);
});

test('heartbeat is fresh only within the stale threshold', () => {
  const now = 1_000_000;
  assert.equal(isHeartbeatStale(now - 9_000, now), false);
  assert.equal(isHeartbeatStale(now - HEARTBEAT_STALE_MS - 1, now), true);
  assert.equal(isHeartbeatStale(0, now), false);
});

test('heartbeat timeout enters offline and later heartbeat recovers', () => {
  const monitor = new ConnectionMonitor();
  monitor.completeProbe(true);
  assert.equal(monitor.heartbeatTimedOut().offline, true);
  assert.equal(monitor.isOnline, false);
  monitor.noteHeartbeat();
  assert.equal(monitor.isOnline, true);
  assert.equal(monitor.failureCount, 0);
});

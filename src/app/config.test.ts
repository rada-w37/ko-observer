import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

const baseEnv = {
  FIREBASE_PROJECT_ID: "project",
  FIREBASE_CLIENT_EMAIL: "client@example.com",
  FIREBASE_PRIVATE_KEY: "private-key",
};

test("loads phase4 observe loop config with defaults", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase4-observe-loop",
    KOO_WORLD_ID: "1001",
  });

  assert.equal(config.mode, "phase4-observe-loop");
  assert.equal(config.worldId, "1001");
  assert.equal(config.observeDurationSeconds, 120);
  assert.equal(config.observeIntervalSeconds, 1);
});

test("loads observe duration and interval env values", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase4-observe-loop",
    KOO_WORLD_ID: "1001",
    KOO_OBSERVE_DURATION_SECONDS: "300",
    KOO_OBSERVE_INTERVAL_SECONDS: "2",
  });

  assert.equal(config.observeDurationSeconds, 300);
  assert.equal(config.observeIntervalSeconds, 2);
});

test("loads phase5 KO observe loop config", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase5-ko-observe-loop",
    KOO_WORLD_ID: "1001",
    KOO_GUILD_ID: "111111111001",
    KOO_OBSERVE_DURATION_SECONDS: "60",
  });

  assert.equal(config.mode, "phase5-ko-observe-loop");
  assert.equal(config.worldId, "1001");
  assert.equal(config.guildId, "111111111001");
  assert.equal(config.observeDurationSeconds, 60);
});

test("loads phase5 KO observe loop config without manual world for production target resolution", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase5-ko-observe-loop",
  });

  assert.equal(config.mode, "phase5-ko-observe-loop");
  assert.equal(config.worldId, undefined);
  assert.equal(config.guildId, undefined);
});

test("loads notification flags with safe defaults", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase5-ko-observe-loop",
  });

  assert.equal(config.notificationsEnabled, false);
  assert.equal(config.notificationsDryRun, true);
});

test("loads notification flags from env", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase5-ko-observe-loop",
    KOO_NOTIFICATIONS_ENABLED: "true",
    KOO_NOTIFICATIONS_DRY_RUN: "false",
  });

  assert.equal(config.notificationsEnabled, true);
  assert.equal(config.notificationsDryRun, false);
});

test("rejects invalid notification flag values", () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        KOO_MODE: "phase5-ko-observe-loop",
        KOO_NOTIFICATIONS_ENABLED: "yes",
      }),
    /KOO_NOTIFICATIONS_ENABLED must be true or false/,
  );

  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        KOO_MODE: "phase5-ko-observe-loop",
        KOO_NOTIFICATIONS_DRY_RUN: "no",
      }),
    /KOO_NOTIFICATIONS_DRY_RUN must be true or false/,
  );
});

test("loads phase6 dummy seed config with clear default", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase6-seed-dummy-guild-ko-totals",
    KOO_WORLD_ID: "1037",
  });

  assert.equal(config.mode, "phase6-seed-dummy-guild-ko-totals");
  assert.equal(config.worldId, "1037");
  assert.equal(config.seedClear, true);
});

test("loads phase6 dummy seed clear false", () => {
  const config = loadConfig({
    ...baseEnv,
    KOO_MODE: "phase6-seed-dummy-guild-ko-totals",
    KOO_WORLD_ID: "1037",
    KOO_SEED_CLEAR: "false",
  });

  assert.equal(config.seedClear, false);
});

test("rejects invalid seed clear value", () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        KOO_MODE: "phase6-seed-dummy-guild-ko-totals",
        KOO_WORLD_ID: "1037",
        KOO_SEED_CLEAR: "yes",
      }),
    /KOO_SEED_CLEAR must be true or false/,
  );
});

test("rejects invalid observe duration and interval values", () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        KOO_MODE: "phase4-observe-loop",
        KOO_WORLD_ID: "1001",
        KOO_OBSERVE_DURATION_SECONDS: "0",
      }),
    /KOO_OBSERVE_DURATION_SECONDS must be a positive number/,
  );

  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        KOO_MODE: "phase4-observe-loop",
        KOO_WORLD_ID: "1001",
        KOO_OBSERVE_INTERVAL_SECONDS: "abc",
      }),
    /KOO_OBSERVE_INTERVAL_SECONDS must be a positive number/,
  );
});

test("rejects observe duration over max limit", () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv,
        KOO_MODE: "phase4-observe-loop",
        KOO_WORLD_ID: "1001",
        KOO_OBSERVE_DURATION_SECONDS: "3601",
      }),
    /KOO_OBSERVE_DURATION_SECONDS must be 3600 or less/,
  );
});

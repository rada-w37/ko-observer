export type AppConfig = {
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  mode: KooMode;
  runId: string;
  worldId?: string;
  ownGuildName?: string;
  observeDurationSeconds: number;
  observeIntervalSeconds: number;
};

export type KooMode =
  | "phase0-smoke-test"
  | "phase1-scope-test"
  | "phase4-observe-loop"
  | "phase5-ko-observe-loop";

const DEFAULT_OBSERVE_DURATION_SECONDS = 120;
const DEFAULT_OBSERVE_INTERVAL_SECONDS = 1;
const MAX_OBSERVE_DURATION_SECONDS = 3600;

const REQUIRED_ENV_KEYS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = loadMode(env.KOO_MODE);
  const missingKeys: string[] = REQUIRED_ENV_KEYS.filter((envKey) => !env[envKey]);

  if (
    (mode === "phase1-scope-test" ||
      mode === "phase4-observe-loop" ||
      mode === "phase5-ko-observe-loop") &&
    !env.KOO_WORLD_ID
  ) {
    missingKeys.push("KOO_WORLD_ID");
  }

  const observeDurationSeconds = loadPositiveNumberEnv(
    env.KOO_OBSERVE_DURATION_SECONDS,
    "KOO_OBSERVE_DURATION_SECONDS",
    DEFAULT_OBSERVE_DURATION_SECONDS,
  );
  const observeIntervalSeconds = loadPositiveNumberEnv(
    env.KOO_OBSERVE_INTERVAL_SECONDS,
    "KOO_OBSERVE_INTERVAL_SECONDS",
    DEFAULT_OBSERVE_INTERVAL_SECONDS,
  );

  if (observeDurationSeconds > MAX_OBSERVE_DURATION_SECONDS) {
    throw new Error(
      `KOO_OBSERVE_DURATION_SECONDS must be ${MAX_OBSERVE_DURATION_SECONDS} or less.`,
    );
  }

  if (missingKeys.length > 0) {
    throw new Error(`Missing required environment variables: ${missingKeys.join(", ")}`);
  }

  return {
    firebaseProjectId: env.FIREBASE_PROJECT_ID as string,
    firebaseClientEmail: env.FIREBASE_CLIENT_EMAIL as string,
    firebasePrivateKey: restorePrivateKey(env.FIREBASE_PRIVATE_KEY as string),
    mode,
    runId: env.GITHUB_RUN_ID ?? "local",
    worldId: env.KOO_WORLD_ID,
    ownGuildName: env.KOO_OWN_GUILD_NAME,
    observeDurationSeconds,
    observeIntervalSeconds,
  };
}

function loadMode(mode: string | undefined): KooMode {
  if (!mode) {
    return "phase0-smoke-test";
  }

  if (
    mode === "phase0-smoke-test" ||
    mode === "phase1-scope-test" ||
    mode === "phase4-observe-loop" ||
    mode === "phase5-ko-observe-loop"
  ) {
    return mode;
  }

  throw new Error(`Unsupported KOO_MODE: ${mode}`);
}

function restorePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}

function loadPositiveNumberEnv(
  rawValue: string | undefined,
  envKey: string,
  defaultValue: number,
): number {
  if (!rawValue) {
    return defaultValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error(`${envKey} must be a positive number.`);
  }

  return parsedValue;
}
